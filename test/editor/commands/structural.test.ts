import { describe, it, expect, beforeEach } from 'vitest'
import { model } from '@coderline/alphatab'
import type { AlphaTabApi } from '@coderline/alphatab'
import {
  SetTimeSignatureCommand,
  SetKeySignatureCommand,
  SetTempoCommand,
  InsertMeasureCommand,
  DeleteMeasureCommand,
  insertMeasureAfterSelection,
  deleteSelectedMeasure,
} from '../../../src/editor/commands'
import { clearHistory, undo, redo } from '../../../src/editor/HistoryRouter'
import { scoreSnapshot } from '../../../src/editor/snapshot'
import { resolveBeat } from '../../../src/editor/selection'
import { store } from '../../../src/editor/store'
import type { BeatRef } from '../../../src/editor/selection'
import { makeMinimalScore } from '../../fixtures/makeMinimalScore'

const ref = (barIndex: number): BeatRef => ({
  trackIndex: 0,
  staffIndex: 0,
  voiceIndex: 0,
  barIndex,
  beatIndex: 0,
})

const sigAt = (score: model.Score, i: number) =>
  `${score.masterBars[i].timeSignatureNumerator}/${score.masterBars[i].timeSignatureDenominator}`

// ── SetTimeSignatureCommand ───────────────────────────────────────────────────────────────────────
describe('SetTimeSignatureCommand', () => {
  it('propagates the new sig from bar N until the next change; undo restores', () => {
    const score = makeMinimalScore({ bars: 4 }) // all default 4/4
    const original = scoreSnapshot(score)

    const cmd = new SetTimeSignatureCommand(ref(1), { num: 3, denom: 4, common: false })
    cmd.apply(score)
    expect(sigAt(score, 0)).toBe('4/4') // bar before N untouched
    expect(sigAt(score, 1)).toBe('3/4')
    expect(sigAt(score, 2)).toBe('3/4')
    expect(sigAt(score, 3)).toBe('3/4')
    expect(cmd.relayout).toBe('score')

    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('stops at the first pre-existing change', () => {
    const score = makeMinimalScore({ bars: 4 })
    new SetTimeSignatureCommand(ref(2), { num: 5, denom: 8, common: false }).apply(score) // bars 2,3 → 5/8
    const original = scoreSnapshot(score)

    const cmd = new SetTimeSignatureCommand(ref(0), { num: 7, denom: 8, common: false })
    cmd.apply(score)
    expect(sigAt(score, 0)).toBe('7/8')
    expect(sigAt(score, 1)).toBe('7/8')
    expect(sigAt(score, 2)).toBe('5/8') // unchanged — the propagation stops here
    expect(sigAt(score, 3)).toBe('5/8')

    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
  })
})

// ── SetKeySignatureCommand ──────────────────────────────────────────────────────────────────────
describe('SetKeySignatureCommand', () => {
  it('propagates key sig until the next change on the selected staff; undo restores', () => {
    const score = makeMinimalScore({ bars: 3 }) // all C major (KeySignature.C / Major)
    const original = scoreSnapshot(score)

    const cmd = new SetKeySignatureCommand(ref(1), model.KeySignature.G, model.KeySignatureType.Major)
    cmd.apply(score)
    const bars = score.tracks[0].staves[0].bars
    expect(bars[0].keySignature).toBe(model.KeySignature.C) // before N untouched
    expect(bars[1].keySignature).toBe(model.KeySignature.G)
    expect(bars[2].keySignature).toBe(model.KeySignature.G)

    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('captures fret-0-style sentinels correctly (KeySignature.C = 0 is a legal value)', () => {
    // Bar 0 already C (=0). Set to F minor, undo must restore to C (0), not stay at F.
    const score = makeMinimalScore({ bars: 2 })
    const cmd = new SetKeySignatureCommand(ref(0), model.KeySignature.F, model.KeySignatureType.Minor)
    cmd.apply(score)
    expect(score.tracks[0].staves[0].bars[0].keySignature).toBe(model.KeySignature.F)
    cmd.undo(score)
    expect(score.tracks[0].staves[0].bars[0].keySignature).toBe(model.KeySignature.C)
    expect(score.tracks[0].staves[0].bars[0].keySignatureType).toBe(model.KeySignatureType.Major)
  })
})

// ── SetTempoCommand ─────────────────────────────────────────────────────────────────────────────
describe('SetTempoCommand', () => {
  it('places one tempo marker at bar start (value === bpm); undo restores the prior array', () => {
    const score = makeMinimalScore({ bars: 2 })
    const original = scoreSnapshot(score)
    expect(score.masterBars[0].tempoAutomations).toHaveLength(0)

    const cmd = new SetTempoCommand(ref(0), 90)
    cmd.apply(score)
    const autos = score.masterBars[0].tempoAutomations
    expect(autos).toHaveLength(1)
    expect(autos[0].value).toBe(90) // reference=2 (quarter note) → value === bpm
    expect(autos[0].ratioPosition).toBe(0)
    expect(autos[0].type).toBe(model.AutomationType.Tempo)
    expect(cmd.relayout).toBe('voice')

    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('replaces an existing marker (one marker per bar)', () => {
    const score = makeMinimalScore({ bars: 1 })
    new SetTempoCommand(ref(0), 90).apply(score)
    new SetTempoCommand(ref(0), 120).apply(score)
    expect(score.masterBars[0].tempoAutomations).toHaveLength(1)
    expect(score.masterBars[0].tempoAutomations[0].value).toBe(120)
  })
})

// ── InsertMeasureCommand ────────────────────────────────────────────────────────────────────────
describe('InsertMeasureCommand', () => {
  it('inserts a quarter-rest measure after N across all staves; undo removes it', () => {
    const score = makeMinimalScore({ bars: 3 })
    const original = scoreSnapshot(score)

    const cmd = new InsertMeasureCommand(ref(0))
    cmd.apply(score)
    expect(score.masterBars).toHaveLength(4)
    expect(score.tracks[0].staves[0].bars).toHaveLength(4)
    const newBar = score.tracks[0].staves[0].bars[1] // inserted after index 0
    expect(newBar.voices).toHaveLength(1)
    expect(newBar.voices[0].beats).toHaveLength(1)
    expect(newBar.voices[0].beats[0].notes).toHaveLength(0) // rest
    expect(cmd.relayout).toBe('score')

    cmd.undo(score)
    expect(score.masterBars).toHaveLength(3)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('inherits time sig and key sig from the previous bar (no spurious change glyph)', () => {
    const score = makeMinimalScore({ bars: 2 })
    // Put the whole score in G major + 3/4 so the inherited values are non-default.
    new SetKeySignatureCommand(ref(0), model.KeySignature.G, model.KeySignatureType.Major).apply(score)
    new SetTimeSignatureCommand(ref(0), { num: 3, denom: 4, common: false }).apply(score)

    new InsertMeasureCommand(ref(0)).apply(score)
    const newBar = score.tracks[0].staves[0].bars[1]
    expect(newBar.keySignature).toBe(model.KeySignature.G) // inherited, NOT default C
    expect(newBar.keySignatureType).toBe(model.KeySignatureType.Major)
    expect(score.masterBars[1].timeSignatureNumerator).toBe(3)
    expect(score.masterBars[1].timeSignatureDenominator).toBe(4)
  })

  it('redo re-inserts the SAME cached objects so undo still finds them', () => {
    const score = makeMinimalScore({ bars: 2 })
    const original = scoreSnapshot(score)
    const cmd = new InsertMeasureCommand(ref(0))
    cmd.apply(score)
    const afterApply = scoreSnapshot(score)
    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
    cmd.apply(score) // redo
    expect(scoreSnapshot(score)).toEqual(afterApply)
    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
  })
})

// ── DeleteMeasureCommand ────────────────────────────────────────────────────────────────────────
describe('DeleteMeasureCommand', () => {
  it('removes the measure at N across all staves; undo re-inserts it', () => {
    const score = makeMinimalScore({ bars: 3 })
    const original = scoreSnapshot(score)

    const cmd = new DeleteMeasureCommand(ref(1))
    cmd.apply(score)
    expect(score.masterBars).toHaveLength(2)
    expect(score.tracks[0].staves[0].bars).toHaveLength(2)

    cmd.undo(score)
    expect(score.masterBars).toHaveLength(3)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('refuses to delete the only remaining measure (no-op)', () => {
    const score = makeMinimalScore({ bars: 1 })
    const original = scoreSnapshot(score)
    new DeleteMeasureCommand(ref(0)).apply(score)
    expect(score.masterBars).toHaveLength(1)
    expect(scoreSnapshot(score)).toEqual(original)
  })
})

// ── Dispatchers: selection shift (the gap reValidateSelection can't see) ──────────────────────────
describe('measure dispatchers — selection shift', () => {
  let score: ReturnType<typeof makeMinimalScore>

  beforeEach(() => {
    clearHistory()
    score = makeMinimalScore({ bars: 3, beatsPerBar: 2 })
    store.setState({
      api: { score, render() {} } as unknown as AlphaTabApi,
      selection: ref(1),
      selectedString: 1,
      canUndo: false,
      canRedo: false,
    })
  })

  it('insert after the selected bar leaves the selection on the SAME music', () => {
    const beatBefore = resolveBeat(store.getState().api!.score!, ref(1))
    insertMeasureAfterSelection()
    expect(store.getState().api!.score!.masterBars).toHaveLength(4)
    const sel = store.getState().selection!
    expect(sel.barIndex).toBe(1) // unchanged: new bar landed at index 2 (after the selection)
    expect(resolveBeat(store.getState().api!.score!, sel)).toBe(beatBefore) // same beat object
  })

  it('delete the selected bar walks the selection back one bar', () => {
    deleteSelectedMeasure()
    expect(store.getState().api!.score!.masterBars).toHaveLength(2)
    expect(store.getState().selection!.barIndex).toBe(0) // was 1, walked back to 0
  })

  it('delete clamps the selection beatIndex against a SHORTER destination bar (non-uniform bars)', () => {
    // Real music has different beat counts per bar. Select a high beat in bar 2, shrink bar 1 to 2
    // beats, then delete bar 2 → selection walks back to bar 1 where beatIndex 3 is out of range and
    // MUST be clamped (this is the ordering bug the uniform fixture couldn't expose).
    store.getState().api!.score!.tracks[0].staves[0].bars[1].voices[0].beats.splice(1) // bar 1 → 1 beat
    // bar 2 has 2 beats (beatsPerBar 2); select its last beat (index 1).
    store.setState({ selection: { trackIndex: 0, staffIndex: 0, voiceIndex: 0, barIndex: 2, beatIndex: 1 } })
    deleteSelectedMeasure()
    const sel = store.getState().selection!
    expect(sel.barIndex).toBe(1)
    expect(sel.beatIndex).toBe(0) // clamped: bar 1 has only 1 beat now, so beatIndex 1 → 0
    expect(resolveBeat(store.getState().api!.score!, sel)).not.toBeNull() // resolves to real music
  })

  it('delete bar 0 clamps the selection at 0 (does not go negative)', () => {
    store.setState({ selection: ref(0) })
    deleteSelectedMeasure()
    expect(store.getState().selection!.barIndex).toBe(0)
  })

  it('delete is a no-op on a single-measure score (pushes no command)', () => {
    clearHistory()
    const oneBar = makeMinimalScore({ bars: 1, beatsPerBar: 2 })
    store.setState({
      api: { score: oneBar, render() {} } as unknown as AlphaTabApi,
      selection: ref(0),
      canUndo: false,
    })
    deleteSelectedMeasure()
    expect(oneBar.masterBars).toHaveLength(1)
    expect(store.getState().canUndo).toBe(false)
  })

  it('insert then undo via the history router round-trips the bar count', () => {
    insertMeasureAfterSelection()
    expect(store.getState().api!.score!.masterBars).toHaveLength(4)
    undo()
    expect(store.getState().api!.score!.masterBars).toHaveLength(3)
    redo()
    expect(store.getState().api!.score!.masterBars).toHaveLength(4)
  })
})
