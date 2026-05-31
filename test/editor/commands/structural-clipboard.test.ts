import { describe, it, expect, beforeEach } from 'vitest'
import { Settings, model } from '@coderline/alphatab'
import type { AlphaTabApi } from '@coderline/alphatab'
import {
  PasteCommand,
  DeleteRangeCommand,
  copySelection,
  cutSelection,
  pasteClipboard,
  clearClipboard,
  CHORD_LIBRARY,
  buildChord,
} from '../../../src/editor/commands'
import { clearHistory, undo, redo } from '../../../src/editor/HistoryRouter'
import { scoreSnapshot } from '../../../src/editor/snapshot'
import {
  resolveVoice,
  resolveBeat,
  normalizeRange,
  activeRange,
  collectRangeBeats,
  extendSelection,
  clearAnchor,
  type BeatRef,
} from '../../../src/editor/selection'
import { store } from '../../../src/editor/store'
import { makeMinimalScore } from '../../fixtures/makeMinimalScore'

const ref = (barIndex: number, beatIndex: number): BeatRef => ({
  trackIndex: 0,
  staffIndex: 0,
  voiceIndex: 0,
  barIndex,
  beatIndex,
})

/** A detached quarter-rest-or-note beat, simulating a beat lifted from a GP7 clone. */
function makeBeat(fret: number): model.Beat {
  const beat = new model.Beat()
  beat.duration = model.Duration.Quarter
  const note = new model.Note()
  note.string = 1
  note.fret = fret
  beat.addNote(note)
  return beat
}

// ── DeleteRangeCommand (pure apply/undo/redo) ────────────────────────────────────────────────────
describe('DeleteRangeCommand', () => {
  it('deletes a multi-bar range; a fully-covered bar collapses to a rest; undo restores all', () => {
    const score = makeMinimalScore({ bars: 3, beatsPerBar: 3, strings: 6 })
    const original = scoreSnapshot(score)
    // bar0 beat1 → bar2 beat1: bar0 keeps beat0, bar1 fully emptied (→ rest), bar2 keeps beat2.
    const range = normalizeRange(ref(0, 1), ref(2, 1))!
    const cmd = new DeleteRangeCommand(range)

    cmd.apply(score)
    expect(resolveVoice(score, ref(0, 0))!.beats.length).toBe(1) // bar0: only beat0 left
    const bar1 = resolveVoice(score, ref(1, 0))!
    expect(bar1.beats.length).toBe(1) // bar1 collapsed to a single rest
    expect(bar1.beats[0].notes.length).toBe(0) // ...which is a rest
    expect(resolveVoice(score, ref(2, 0))!.beats.length).toBe(1) // bar2: only beat2 left
    expect(scoreSnapshot(score)).not.toEqual(original)

    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)

    cmd.apply(score) // redo
    expect(resolveVoice(score, ref(1, 0))!.beats.length).toBe(1)
    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('collapses a single-beat bar to a rest rather than emptying it', () => {
    const score = makeMinimalScore({ bars: 2, beatsPerBar: 1, strings: 6 })
    const original = scoreSnapshot(score)
    const cmd = new DeleteRangeCommand(normalizeRange(ref(0, 0), ref(0, 0))!)
    cmd.apply(score)
    const v = resolveVoice(score, ref(0, 0))!
    expect(v.beats.length).toBe(1)
    expect(v.beats[0].notes.length).toBe(0) // rest, not an empty voice
    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
  })
})

// ── PasteCommand (pure apply/undo/redo) ──────────────────────────────────────────────────────────
describe('PasteCommand', () => {
  it('inserts beats after the target, shifting right; undo removes; redo re-inserts', () => {
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 2, strings: 6 })
    const original = scoreSnapshot(score)
    const voice = resolveVoice(score, ref(0, 0))!
    expect(voice.beats.length).toBe(2)

    const cmd = new PasteCommand(ref(0, 0), [makeBeat(7), makeBeat(9)], new Map())
    cmd.apply(score)
    // [orig0, 7, 9, orig1] — pasted inserted AFTER beat 0
    expect(voice.beats.length).toBe(4)
    expect(voice.beats[1].notes[0].fret).toBe(7)
    expect(voice.beats[2].notes[0].fret).toBe(9)
    expect(scoreSnapshot(score)).not.toEqual(original)

    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)

    cmd.apply(score) // redo re-splices the SAME objects
    expect(resolveVoice(score, ref(0, 0))!.beats.length).toBe(4)
    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('carries a chord into the target staff (registers it; undo unregisters; redo re-registers)', () => {
    // Force the cross-staff condition the single-track happy path hides: the target staff has the
    // chord NOT already registered, so resolution depends entirely on PasteCommand registering it.
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 1, strings: 6 })
    const staff = score.tracks[0].staves[0]
    expect(staff.chords == null || staff.chords.size === 0).toBe(true) // no chords registered yet

    const def = CHORD_LIBRARY[0]
    const pasted = makeBeat(3)
    pasted.chordId = def.name
    const cmd = new PasteCommand(ref(0, 0), [pasted], new Map([[def.name, buildChord(def)]]))

    cmd.apply(score)
    expect(staff.chords?.has(def.name)).toBe(true) // registered into the TARGET staff
    const beat = resolveBeat(score, ref(0, 1))! // the pasted beat (after the seed beat 0)
    expect(beat.chordId).toBe(def.name)
    expect(beat.chord).toBeTruthy() // chordId now resolves against the staff map

    cmd.undo(score)
    expect(staff.chords == null || !staff.chords.has(def.name)).toBe(true) // registration removed

    cmd.apply(score) // redo
    expect(staff.chords?.has(def.name)).toBe(true)
    cmd.undo(score)
  })
})

// ── Range-selection helpers ──────────────────────────────────────────────────────────────────────
describe('range-selection helpers', () => {
  const score = makeMinimalScore({ bars: 2, beatsPerBar: 2, strings: 6 })
  beforeEach(() => {
    store.setState({
      api: { score, settings: new Settings(), render: () => {} } as unknown as AlphaTabApi,
      selection: ref(0, 0),
      anchor: null,
      selectedString: 1,
    })
  })

  it('normalizeRange orders ascending and refuses cross-voice', () => {
    expect(normalizeRange(ref(1, 1), ref(0, 0))).toEqual(
      normalizeRange(ref(0, 0), ref(1, 1)), // direction-independent
    )
    const r = normalizeRange(ref(1, 1), ref(0, 0))!
    expect([r.fromBar, r.fromBeat, r.toBar, r.toBeat]).toEqual([0, 0, 1, 1])
    expect(normalizeRange({ ...ref(0, 0), trackIndex: 1 }, ref(0, 0))).toBeNull()
  })

  it('extendSelection seeds the anchor then moves the focus; can cross bars', () => {
    extendSelection(1) // 0.0 → 0.1, anchor seeded at 0.0
    expect(store.getState().anchor).toEqual(ref(0, 0))
    expect(store.getState().selection).toEqual(ref(0, 1))
    extendSelection(1) // 0.1 → 1.0 (across the bar), anchor unchanged
    expect(store.getState().anchor).toEqual(ref(0, 0))
    expect(store.getState().selection).toEqual(ref(1, 0))
  })

  it('clearAnchor drops the range, keeping the focus', () => {
    store.setState({ anchor: ref(0, 0), selection: ref(1, 1) })
    clearAnchor()
    expect(store.getState().anchor).toBeNull()
    expect(store.getState().selection).toEqual(ref(1, 1))
  })

  it('activeRange falls back to a single-beat range when no anchor is set', () => {
    const r = activeRange()!
    expect([r.fromBar, r.fromBeat, r.toBar, r.toBeat]).toEqual([0, 0, 0, 0])
  })

  it('collectRangeBeats walks across bars in order', () => {
    const r = normalizeRange(ref(0, 1), ref(1, 0))! // bar0 beat1, then bar1 beat0
    const beats = collectRangeBeats(score, r)
    expect(beats.length).toBe(2)
    expect(beats[0]).toBe(score.tracks[0].staves[0].bars[0].voices[0].beats[1])
    expect(beats[1]).toBe(score.tracks[0].staves[0].bars[1].voices[0].beats[0])
  })
})

// ── Copy / cut / paste dispatchers (full GP7 round-trip through the store) ────────────────────────
describe('clipboard dispatchers (copy/cut/paste round-trip)', () => {
  beforeEach(() => {
    clearHistory()
    clearClipboard()
  })

  function setup() {
    const score = makeMinimalScore({ bars: 2, beatsPerBar: 2, strings: 6 })
    score.finish(new Settings())
    store.setState({
      api: { score, settings: new Settings(), render: () => {} } as unknown as AlphaTabApi,
      selection: ref(0, 0),
      anchor: null,
      selectedString: 1,
    })
    return score
  }

  it('copy a range then paste at a caret inserts faithful copies and lands a caret at the run end', () => {
    const score = setup()
    // Record the source frets (bar0: beat0 and beat1, string 1).
    const srcVoice = resolveVoice(score, ref(0, 0))!
    const srcFrets = [srcVoice.beats[0].notes.find((n) => n.string === 1)!.fret,
                      srcVoice.beats[1].notes.find((n) => n.string === 1)!.fret]

    // Select the range bar0 beat0..beat1, copy it.
    store.setState({ anchor: ref(0, 0), selection: ref(0, 1) })
    copySelection()

    // Move to bar1 beat0 (no range — a caret) and paste.
    store.setState({ anchor: null, selection: ref(1, 0) })
    pasteClipboard()

    const tgtVoice = resolveVoice(store.getState().api!.score!, ref(1, 0))!
    // [orig, pasted0, pasted1, orig] — bar1 had 2 beats; paste 2 after beat0 → 4 total.
    expect(tgtVoice.beats.length).toBe(4)
    expect(tgtVoice.beats[1].notes.find((n) => n.string === 1)!.fret).toBe(srcFrets[0])
    expect(tgtVoice.beats[2].notes.find((n) => n.string === 1)!.fret).toBe(srcFrets[1])

    // Selection collapses to a CARET at the last pasted beat (beat 2 of bar1), anchor cleared — so a
    // repeated ⌘V inserts-after and chains, instead of seeing a range and replacing the run.
    expect(store.getState().anchor).toBeNull()
    expect(store.getState().selection).toEqual(ref(1, 2))
  })

  it('repeated ⌘V chains the riff (caret-collapse keeps insert-after, never self-replace)', () => {
    const score = setup()
    // Copy beat0..beat1 of bar0 (a 2-beat riff).
    store.setState({ anchor: ref(0, 0), selection: ref(0, 1) })
    copySelection()
    // Paste at a caret in bar1, then ⌘V again with no manual reselection.
    store.setState({ anchor: null, selection: ref(1, 0) })
    pasteClipboard()
    expect(resolveVoice(store.getState().api!.score!, ref(1, 0))!.beats.length).toBe(4)
    pasteClipboard() // selection is the trailing caret from the first paste
    expect(resolveVoice(store.getState().api!.score!, ref(1, 0))!.beats.length).toBe(6) // chained, not replaced
  })

  it('REPLACE: a within-bar range is overwritten — A [B C] D → A X Y D, undone in one step', () => {
    // A 4-beat target bar gives us A B C D to select B C out of.
    const wide = makeMinimalScore({ bars: 2, beatsPerBar: 4, strings: 6 })
    wide.finish(new Settings())
    store.setState({
      api: { score: wide, settings: new Settings(), render: () => {} } as unknown as AlphaTabApi,
      selection: ref(0, 0),
      anchor: null,
      selectedString: 1,
    })
    // Tag the four beats of bar0 by fret so we can read placement: A=0 B=1 C=2 D=3.
    const v = resolveVoice(wide, ref(0, 0))!
    v.beats.forEach((b, i) => (b.notes.find((n) => n.string === 1)!.fret = i))

    // Copy a 2-beat riff (X Y) from bar1 beats 0..1, frets tagged 7 / 9.
    const src = resolveVoice(wide, ref(1, 0))!
    src.beats[0].notes.find((n) => n.string === 1)!.fret = 7
    src.beats[1].notes.find((n) => n.string === 1)!.fret = 9
    store.setState({ anchor: ref(1, 0), selection: ref(1, 1) })
    copySelection()

    // Select B C (bar0 beats 1..2) and paste → replace.
    store.setState({ anchor: ref(0, 1), selection: ref(0, 2) })
    const before = scoreSnapshot(wide)
    pasteClipboard()

    const out = resolveVoice(store.getState().api!.score!, ref(0, 0))!
    const frets = out.beats.map((b) => b.notes.find((n) => n.string === 1)!.fret)
    expect(frets).toEqual([0, 7, 9, 3]) // A X Y D — B and C replaced, no stray rest, length preserved
    expect(store.getState().anchor).toBeNull()
    expect(store.getState().selection).toEqual(ref(0, 2)) // caret on the last pasted beat (Y)

    undo() // a single step reverts the whole replace
    expect(scoreSnapshot(store.getState().api!.score!)).toEqual(before)

    redo() // and redo re-applies the whole composite (paste then delete)
    const after = resolveVoice(store.getState().api!.score!, ref(0, 0))!
    expect(after.beats.map((b) => b.notes.find((n) => n.string === 1)!.fret)).toEqual([0, 7, 9, 3])
  })

  it('REPLACE: a whole single bar yields the riff with NO stray rest (paste-then-delete)', () => {
    setup() // bar0/bar1 each 2 beats
    // Copy a 2-beat riff from bar1.
    store.setState({ anchor: ref(1, 0), selection: ref(1, 1) })
    copySelection()
    // Select the WHOLE of bar0 (both beats) and paste over it.
    store.setState({ anchor: ref(0, 0), selection: ref(0, 1) })
    pasteClipboard()

    const v = resolveVoice(store.getState().api!.score!, ref(0, 0))!
    // The bar holds exactly the 2 pasted beats — NOT a synthesized rest beside them. (delete-then-paste
    // would empty the bar first, forcing a rest; paste-then-delete keeps it non-empty throughout.)
    expect(v.beats.length).toBe(2)
    expect(v.beats.every((b) => b.notes.length > 0)).toBe(true) // no rest
  })

  it('cut writes the clipboard in the dispatcher and deletes the range as one undo step', () => {
    const score = setup()
    store.setState({ anchor: ref(0, 0), selection: ref(0, 1) }) // whole bar0
    cutSelection()
    // bar0 fully covered → collapsed to a single rest.
    const v = resolveVoice(store.getState().api!.score!, ref(0, 0))!
    expect(v.beats.length).toBe(1)
    expect(v.beats[0].notes.length).toBe(0)
    expect(score.masterBars.length).toBe(2) // cut never removes bars

    // What was cut can now be pasted.
    store.setState({ anchor: null, selection: ref(1, 0) })
    pasteClipboard()
    expect(resolveVoice(store.getState().api!.score!, ref(1, 0))!.beats.length).toBe(4)
  })

  it('paste falls back to the single-beat selection when no range is active', () => {
    setup()
    store.setState({ anchor: null, selection: ref(0, 0) })
    copySelection() // copies just beat 0.0
    store.setState({ selection: ref(1, 1) })
    pasteClipboard()
    expect(resolveVoice(store.getState().api!.score!, ref(1, 0))!.beats.length).toBe(3) // 2 + 1 pasted
  })
})
