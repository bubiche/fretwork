import { describe, it, expect } from 'vitest'
import { model, Settings } from '@coderline/alphatab'
import { SetChordCommand, buildChord, CHORD_LIBRARY } from '../../../../src/editor/commands'
import { scoreSnapshot } from '../../../../src/editor/snapshot'
import { resolveBeat } from '../../../../src/editor/selection'
import type { BeatRef } from '../../../../src/editor/selection'
import { makeMinimalScore } from '../../../fixtures/makeMinimalScore'

// A chord assignment is TWO writes — register the Chord in `staff.chords`, then point
// the beat at it via `beat.chordId`. This test drives apply → finish → undo → finish (the diagram is
// `relayout:'voice'`, rendered in an above-bar band finish() builds) to prove:
//   (1) registration handles the null `staff.chords` map on the synthetic score (alphaTab's addChord
//       lazy-inits it AND sets the chord.staff backref the renderer reads), and
//   (2) undo restores the prior chordId and the snapshot round-trips clean even though the chord
//       stays registered in the map (the map is a side-table the snapshot deliberately ignores).

const ref = (beatIndex: number): BeatRef => ({
  trackIndex: 0,
  staffIndex: 0,
  voiceIndex: 0,
  barIndex: 0,
  beatIndex,
})
const finish = (score: model.Score) => score.finish(new Settings())
const cMajor = CHORD_LIBRARY.find((c) => c.name === 'C')!

describe('SetChordCommand: registration + assignment with clean undo', () => {
  it('apply registers the chord (null map → lazy-init) and points the beat at it', () => {
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 2, strings: 6 })
    const staff = score.tracks[0].staves[0]
    expect(staff.chords).toBeNull() // synthetic score starts with no chord library

    const cmd = new SetChordCommand(ref(0), cMajor.name, buildChord(cMajor))
    cmd.apply(score)
    finish(score)

    const beat = resolveBeat(score, ref(0))!
    expect(beat.chordId).toBe('C')
    expect(staff.chords).not.toBeNull()
    expect(staff.chords!.get('C')).toBe(beat.chord) // chordId resolves to the registered diagram
    expect(beat.chord!.staff).toBe(staff) // addChord set the backref the renderer reads
    expect(beat.chord!.strings).toEqual(cMajor.strings)
    expect(beat.chord!.strings.length).toBe(staff.tuning.length) // 6-string invariant
  })

  it('undo restores the prior chordId AND the prior chord registry; snapshot round-trips clean', () => {
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 2, strings: 6 })
    finish(score)
    const original = scoreSnapshot(score)
    const staff = score.tracks[0].staves[0]

    const cmd = new SetChordCommand(ref(0), cMajor.name, buildChord(cMajor))
    cmd.apply(score)
    finish(score)
    expect(scoreSnapshot(score)).not.toEqual(original)
    expect(staff.chords!.has('C')).toBe(true)

    cmd.undo(score)
    finish(score)
    expect(resolveBeat(score, ref(0))!.chordId).toBeNull()
    expect(staff.chords).toBeNull() // registry restored to its prior (empty) state — no ghost left
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('switching C→Cm garbage-collects the orphaned C registration (the ghost-diagram fix)', () => {
    // alphaTab's chord-diagram overview band renders EVERY entry in staff.chords, so an orphaned
    // registration shows a ghost diagram. Switching must leave only the chord still in use.
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 2, strings: 6 })
    const staff = score.tracks[0].staves[0]
    const cm = CHORD_LIBRARY.find((c) => c.name === 'Cm')!

    const setC = new SetChordCommand(ref(0), cMajor.name, buildChord(cMajor))
    setC.apply(score)
    const setCm = new SetChordCommand(ref(0), cm.name, buildChord(cm))
    setCm.apply(score)

    expect(resolveBeat(score, ref(0))!.chordId).toBe('Cm')
    expect([...staff.chords!.keys()]).toEqual(['Cm']) // C is gone — no ghost in the overview band

    setCm.undo(score)
    expect(resolveBeat(score, ref(0))!.chordId).toBe('C')
    expect([...staff.chords!.keys()]).toEqual(['C']) // undo brings C back, drops Cm
  })

  it('keeps a chord registered while another beat still references it', () => {
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 2, strings: 6 })
    const staff = score.tracks[0].staves[0]
    new SetChordCommand(ref(0), cMajor.name, buildChord(cMajor)).apply(score)
    new SetChordCommand(ref(1), cMajor.name, buildChord(cMajor)).apply(score) // beat 1 also = C
    const am = CHORD_LIBRARY.find((c) => c.name === 'Am')!
    new SetChordCommand(ref(0), am.name, buildChord(am)).apply(score) // beat 0 → Am
    // C must survive — beat 1 still uses it — and Am is now registered too.
    expect(new Set(staff.chords!.keys())).toEqual(new Set(['C', 'Am']))
  })

  it('redo re-points the beat (chord already registered → idempotent addChord)', () => {
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 2, strings: 6 })
    const cmd = new SetChordCommand(ref(0), cMajor.name, buildChord(cMajor))
    cmd.apply(score)
    cmd.undo(score)
    cmd.apply(score) // redo
    finish(score)
    const staff = score.tracks[0].staves[0]
    expect(resolveBeat(score, ref(0))!.chordId).toBe('C')
    expect(staff.chords!.size).toBe(1) // not double-registered
  })

  it('reassigning a different chord captures the prior id; undo restores it', () => {
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 2, strings: 6 })
    const am = CHORD_LIBRARY.find((c) => c.name === 'Am')!
    new SetChordCommand(ref(0), cMajor.name, buildChord(cMajor)).apply(score)
    const swap = new SetChordCommand(ref(0), am.name, buildChord(am))
    swap.apply(score)
    expect(resolveBeat(score, ref(0))!.chordId).toBe('Am')
    swap.undo(score)
    expect(resolveBeat(score, ref(0))!.chordId).toBe('C') // prior id, not null
  })

  it('clear (null chordId) is its own command; undo restores the cleared chord', () => {
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 2, strings: 6 })
    new SetChordCommand(ref(0), cMajor.name, buildChord(cMajor)).apply(score)
    const clear = new SetChordCommand(ref(0), null, null)
    clear.apply(score)
    expect(resolveBeat(score, ref(0))!.chordId).toBeNull()
    clear.undo(score)
    expect(resolveBeat(score, ref(0))!.chordId).toBe('C')
  })
})
