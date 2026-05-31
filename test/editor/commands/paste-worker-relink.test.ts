import { describe, it, expect } from 'vitest'
import { Settings, model } from '@coderline/alphatab'
import { prepareClonedBeats, PasteCommand, DeleteRangeCommand } from '../../../src/editor/commands'
import { normalizeRange, resolveVoice, type BeatRef } from '../../../src/editor/selection'
import { makeMinimalScore } from '../../fixtures/makeMinimalScore'

/**
 * Regression coverage for the paste crash: a pasted riff whose tie/hammer-on/slide partner wasn't
 * copied crashed the alphaTab RENDER WORKER, not the main thread. alphaTab serializes the score to
 * the worker, which re-links notes BY ID in `Note.chain` (via `JsonConverter.jsObjectToScore`). The
 * build-check that cleared "splice survival" only ran main-thread `finish()` and never this worker
 * round-trip — which is exactly why the bug shipped.
 *
 * `JsonConverter` lives only in the worker bundle and is not exported, so we drive the SAME serialize
 * → deserialize → chain path here with alphaTab's own public methods on the main-bundle `model.Note`:
 *   - `note.toJson(map)` — the real hook that injects the link ids (`tieoriginnoteid`, …) the worker
 *     reads. This is the actual serialized payload, not a proxy field-inspection.
 *   - rebuild a fresh note per entry, preserving `id` (what `NoteSerializer.toJson` writes as `"id"`)
 *     and replaying every key via `setProperty` — exactly how the worker reconstructs notes.
 *   - `note.chain(sharedDataBag)` in score order — the crashing frame itself.
 * A dangling link id (no matching note) → `noteIdLookup.get(id)` is `undefined` → throws. Verified
 * to throw the production message ("Cannot set properties of undefined") before the fix.
 */
function roundtripChain(notes: model.Note[]): model.Note[] {
  const serialized = notes.map((n) => {
    const map = new Map<string, unknown>()
    n.toJson(map) // real alphaTab hook: writes the *noteid link properties
    return { id: n.id, map }
  })
  const fresh = serialized.map((s) => {
    const nn = new model.Note()
    nn.id = s.id // NoteSerializer round-trips the id; the worker's lookup is keyed by it
    for (const [k, v] of s.map) nn.setProperty(k, v)
    return nn
  })
  const sharedDataBag = new Map<string, unknown>()
  for (const nn of fresh) nn.chain(sharedDataBag as never) // the frame that crashed
  return fresh
}

function notesOf(beats: model.Beat[]): model.Note[] {
  return beats.flatMap((b) => b.notes)
}

function scoreNotes(score: model.Score): model.Note[] {
  const out: model.Note[] = []
  for (const track of score.tracks)
    for (const staff of track.staves)
      for (const bar of staff.bars)
        for (const voice of bar.voices)
          for (const beat of voice.beats) out.push(...beat.notes)
  return out
}

function quarter(fret: number, string = 1): model.Beat {
  const beat = new model.Beat()
  beat.duration = model.Duration.Quarter
  const note = new model.Note()
  note.string = string
  note.fret = fret
  beat.addNote(note)
  return beat
}

const ref = (barIndex: number, beatIndex: number): BeatRef => ({
  trackIndex: 0,
  staffIndex: 0,
  voiceIndex: 0,
  barIndex,
  beatIndex,
})

describe('paste — worker JSON relink survival (prepareClonedBeats)', () => {
  it('reproduces the real worker crash for a tie whose origin was not copied, and the fix clears it', () => {
    // Build a two-beat source tie (origin → destination); copy ONLY the destination beat. Its note
    // keeps a pointer to the origin note that did NOT travel — the exact paste-boundary case.
    const origin = quarter(5)
    const dest = quarter(5)
    origin.notes[0].tieDestination = dest.notes[0]
    dest.notes[0].tieOrigin = origin.notes[0]
    dest.notes[0].isTieDestination = true
    const fragment = [dest] // origin beat left behind

    // Failing-first: the lifted beat as-is crashes the worker relink with the production message.
    expect(() => roundtripChain(notesOf(fragment))).toThrowError(/Cannot set properties of undefined/)

    // The fix severs the cross-boundary link.
    prepareClonedBeats(makeMinimalScore({ bars: 1, beatsPerBar: 1, strings: 6 }), fragment)
    expect(dest.notes[0].tieOrigin).toBeNull()
    expect(dest.notes[0].isTieDestination).toBe(false)
    expect(() => roundtripChain(notesOf(fragment))).not.toThrow()
  })

  it('reproduces and fixes the same crash for a cross-boundary hammer-on and slide', () => {
    // Hammer-on destination whose origin wasn't copied.
    const hopoDest = quarter(7)
    const hopoOrigin = quarter(5)
    hopoOrigin.notes[0].hammerPullDestination = hopoDest.notes[0]
    hopoOrigin.notes[0].isHammerPullOrigin = true
    hopoDest.notes[0].hammerPullOrigin = hopoOrigin.notes[0]
    // Legato slide into a target that wasn't copied.
    const slideSrc = quarter(3)
    const slideTgt = quarter(5)
    slideSrc.notes[0].slideTarget = slideTgt.notes[0]
    slideSrc.notes[0].slideOutType = model.SlideOutType.Legato
    const fragment = [hopoDest, slideSrc] // both partners left behind

    expect(() => roundtripChain(notesOf(fragment))).toThrowError(/Cannot set properties of undefined/)

    prepareClonedBeats(makeMinimalScore({ bars: 1, beatsPerBar: 1, strings: 6 }), fragment)
    expect(hopoDest.notes[0].hammerPullOrigin).toBeNull()
    expect(slideSrc.notes[0].slideTarget).toBeNull()
    expect(slideSrc.notes[0].slideOutType).toBe(model.SlideOutType.None)
    expect(() => roundtripChain(notesOf(fragment))).not.toThrow()
  })

  it('keeps an intra-fragment tie (both ends copied) — fidelity, relinks through the round-trip', () => {
    const origin = quarter(5)
    const dest = quarter(5)
    origin.notes[0].tieDestination = dest.notes[0]
    dest.notes[0].tieOrigin = origin.notes[0]
    dest.notes[0].isTieDestination = true
    const fragment = [origin, dest] // BOTH copied

    prepareClonedBeats(makeMinimalScore({ bars: 1, beatsPerBar: 1, strings: 6 }), fragment)
    // Pointers survive prep…
    expect(origin.notes[0].tieDestination).toBe(dest.notes[0])
    expect(dest.notes[0].tieOrigin).toBe(origin.notes[0])
    // …and the worker round-trip relinks them by id without crashing.
    const fresh = roundtripChain(notesOf(fragment))
    expect(fresh[1].tieOrigin).toBe(fresh[0])
    expect(fresh[0].tieDestination).toBe(fresh[1])
  })

  it('reassigns note AND beat ids above the target max so worker lookups cannot collide', () => {
    // Simulate the import-reset collision: the clone fragment reuses ids the target already holds.
    const target = makeMinimalScore({ bars: 1, beatsPerBar: 2, strings: 6 })
    const targetIds = new Set(scoreNotes(target).map((n) => n.id))
    const fragment = [quarter(7), quarter(9)]
    const firstTargetBeatId = target.tracks[0].staves[0].bars[0].voices[0].beats[0].id
    fragment[0].notes[0].id = [...targetIds][0] // force a note-id collision
    fragment[0].id = firstTargetBeatId // force a beat-id collision (misplaces overlay bounds)
    expect(targetIds.has(fragment[0].notes[0].id)).toBe(true) // failing-first: collision present

    prepareClonedBeats(target, fragment)

    const maxBeatId = Math.max(
      ...target.tracks[0].staves[0].bars[0].voices[0].beats.map((b) => b.id),
    )
    for (const beat of fragment) {
      expect(beat.id).toBeGreaterThan(maxBeatId)
      for (const note of beat.notes) expect(targetIds.has(note.id)).toBe(false)
    }

    // After splicing in, every note id across the whole score is unique (no worker lookup collision).
    new PasteCommand(ref(0, 0), fragment, new Map()).apply(target)
    const allIds = scoreNotes(target).map((n) => n.id)
    expect(new Set(allIds).size).toBe(allIds.length)

    // …and the NEXT note/beat allocated (a later AddNote/InsertBeat) must not reuse a pasted id —
    // prepareClonedBeats has to advance alphaTab's global counters, which the clone import reset low.
    const pastedNoteIds = new Set(notesOf(fragment).map((n) => n.id))
    const pastedBeatIds = new Set(fragment.map((b) => b.id))
    expect(pastedNoteIds.has(new model.Note().id)).toBe(false)
    expect(pastedBeatIds.has(new model.Beat().id)).toBe(false)
  })

  it('DELETE/CUT that splits a tie severs the surviving partner (no worker crash); undo re-ties', () => {
    // The mirror of the paste hazard, from the DELETION side: cut/replace deletes the tie ORIGIN and
    // the surviving DESTINATION is left pointing at a detached note → the same worker crash. Both `cut`
    // and paste-over-range run DeleteRangeCommand, so fixing it there covers both.
    const tieUp = (score: model.Score) => {
      const v = resolveVoice(score, ref(0, 0))!
      v.beats[0].notes[0].tieDestination = v.beats[1].notes[0]
      v.beats[1].notes[0].tieOrigin = v.beats[0].notes[0]
      v.beats[1].notes[0].isTieDestination = true
    }

    // Failing-first — prove the fix is load-bearing: a sever-LESS removal of the origin beat (what the
    // delete used to be) leaves the surviving destination dangling, and the worker relink throws.
    const probe = makeMinimalScore({ bars: 1, beatsPerBar: 3, strings: 6 })
    probe.finish(new Settings())
    tieUp(probe)
    resolveVoice(probe, ref(0, 0))!.beats.splice(0, 1) // drop the origin beat, no severing
    expect(() => roundtripChain(scoreNotes(probe))).toThrowError(/Cannot set properties of undefined/)

    // Now the real command, which DOES sever.
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 3, strings: 6 })
    score.finish(new Settings())
    const voice = resolveVoice(score, ref(0, 0))!
    const origin = voice.beats[0].notes[0]
    const dest = voice.beats[1].notes[0]
    tieUp(score)

    const cmd = new DeleteRangeCommand(normalizeRange(ref(0, 0), ref(0, 0))!) // delete beat0 (the origin)
    cmd.apply(score)
    score.finish(new Settings())

    // Survivor's stale back-pointer is gone, so the surviving score round-trips clean.
    expect(dest.tieOrigin).toBeNull()
    expect(dest.isTieDestination).toBe(false)
    expect(() => roundtripChain(scoreNotes(score))).not.toThrow()

    // Undo restores the deleted beat AND re-ties the survivor (one clean inverse).
    cmd.undo(score)
    expect(dest.tieOrigin).toBe(origin)
    expect(dest.isTieDestination).toBe(true)
    expect(origin.tieDestination).toBe(dest)
  })

  it('DELETE the slide TARGET (source survives) — works because finish() makes slides symmetric', () => {
    // `survivingLinkPartners` finds survivors via the DELETED note's own pointers, so it only works if
    // the link is bidirectional. Slides are set one-sided in the model (`source.slideTarget`), but
    // `finish()` populates `target.slideOrigin` — and the command path always runs finished. This guards
    // that invariant: delete the TARGET and the surviving SOURCE must still be severed (no worker crash).
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 3, strings: 6 })
    const v = resolveVoice(score, ref(0, 0))!
    const source = v.beats[0].notes[0]
    const target = v.beats[1].notes[0]
    source.slideTarget = target
    source.slideOutType = model.SlideOutType.Shift
    score.finish(new Settings()) // symmetrizes: target.slideOrigin → source

    const cmd = new DeleteRangeCommand(normalizeRange(ref(0, 1), ref(0, 1))!) // delete the TARGET beat
    cmd.apply(score)
    score.finish(new Settings())

    expect(source.slideTarget).toBeNull()
    expect(source.slideOutType).toBe(model.SlideOutType.None)
    expect(() => roundtripChain(scoreNotes(score))).not.toThrow()

    cmd.undo(score)
    expect(source.slideTarget).toBe(target)
    expect(source.slideOutType).toBe(model.SlideOutType.Shift)
  })
})
