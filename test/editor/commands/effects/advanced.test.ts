import { describe, it, expect, beforeEach } from 'vitest'
import { model } from '@coderline/alphatab'
import type { AlphaTabApi } from '@coderline/alphatab'
import {
  SetNoteEffectCommand,
  SetBeatEffectCommand,
  toggleSelectedTap,
  setSelectedHarmonic,
} from '../../../../src/editor/commands'
import { resolveNote } from '../../../../src/editor/ScoreMutator'
import { resolveBeat } from '../../../../src/editor/selection'
import { store } from '../../../../src/editor/store'
import { clearHistory } from '../../../../src/editor/HistoryRouter'
import type { BeatRef } from '../../../../src/editor/selection'
import { makeMinimalScore } from '../../../fixtures/makeMinimalScore'

// tap (beat-level bool) and harmonics (note-level enum) ride the generic single-field
// commands. Plain value writes — no finish() needed (the linked/curve commands own the finish-driven
// cases). Capture-once `=== null` is load-bearing: `tap=false` and `HarmonicType.None=0` are falsy
// but legal "off" values, so a truthiness guard would mis-capture.

const ref = (barIndex: number, beatIndex: number): BeatRef => ({
  trackIndex: 0,
  staffIndex: 0,
  voiceIndex: 0,
  barIndex,
  beatIndex,
})

describe('SetBeatEffectCommand (tap, beat-level)', () => {
  it('apply sets tap true, undo restores false', () => {
    const score = makeMinimalScore()
    const at = ref(0, 0)
    expect(resolveBeat(score, at)!.tap).toBe(false)

    const cmd = new SetBeatEffectCommand(at, 'tap', true, { label: 'Tap' })
    cmd.apply(score)
    expect(resolveBeat(score, at)!.tap).toBe(true)
    cmd.undo(score)
    expect(resolveBeat(score, at)!.tap).toBe(false)
  })

  it('toggling OFF restores a prior true (false is not mis-read as uncaptured)', () => {
    const score = makeMinimalScore()
    const at = ref(0, 0)
    resolveBeat(score, at)!.tap = true

    const cmd = new SetBeatEffectCommand(at, 'tap', false)
    cmd.apply(score)
    expect(resolveBeat(score, at)!.tap).toBe(false)
    cmd.undo(score)
    expect(resolveBeat(score, at)!.tap).toBe(true)
  })
})

describe('SetNoteEffectCommand (harmonicType, note-level)', () => {
  it('apply sets Natural, undo restores None (enum 0 is a legal prior)', () => {
    const score = makeMinimalScore()
    const at = ref(0, 0)
    expect(resolveNote(score, at, 1)!.harmonicType).toBe(model.HarmonicType.None)

    const cmd = new SetNoteEffectCommand(at, 1, 'harmonicType', model.HarmonicType.Natural, {
      label: 'Harmonic',
    })
    cmd.apply(score)
    expect(resolveNote(score, at, 1)!.harmonicType).toBe(model.HarmonicType.Natural)
    cmd.undo(score)
    expect(resolveNote(score, at, 1)!.harmonicType).toBe(model.HarmonicType.None)
  })

  it('Pinch round-trips the same way', () => {
    const score = makeMinimalScore()
    const at = ref(0, 0)
    const cmd = new SetNoteEffectCommand(at, 1, 'harmonicType', model.HarmonicType.Pinch)
    cmd.apply(score)
    expect(resolveNote(score, at, 1)!.harmonicType).toBe(model.HarmonicType.Pinch)
    cmd.undo(score)
    expect(resolveNote(score, at, 1)!.harmonicType).toBe(model.HarmonicType.None)
  })
})

describe('toggleSelectedTap / setSelectedHarmonic (dispatchers)', () => {
  let score: ReturnType<typeof makeMinimalScore>
  const at = ref(0, 0)

  beforeEach(() => {
    clearHistory()
    score = makeMinimalScore({ strings: 6 })
    store.setState({
      api: { score, render() {} } as unknown as AlphaTabApi,
      selection: at,
      selectedString: 1,
      canUndo: false,
      canRedo: false,
    })
  })

  it('toggleSelectedTap: toggles the beat flag on and off (each its own command)', () => {
    toggleSelectedTap()
    expect(resolveBeat(score, at)!.tap).toBe(true)
    toggleSelectedTap()
    expect(resolveBeat(score, at)!.tap).toBe(false)
  })

  it('setSelectedHarmonic: sets the type, then None clears it', () => {
    setSelectedHarmonic(model.HarmonicType.Natural)
    expect(resolveNote(score, at, 1)!.harmonicType).toBe(model.HarmonicType.Natural)
    setSelectedHarmonic(model.HarmonicType.None)
    expect(resolveNote(score, at, 1)!.harmonicType).toBe(model.HarmonicType.None)
  })

  it('setSelectedHarmonic: no-op (pushes nothing) when re-picking the already-set type', () => {
    setSelectedHarmonic(model.HarmonicType.Pinch)
    expect(store.getState().canUndo).toBe(true)
    clearHistory()
    store.setState({ canUndo: false })
    setSelectedHarmonic(model.HarmonicType.Pinch) // already Pinch
    expect(store.getState().canUndo).toBe(false)
  })

  it('setSelectedHarmonic: no-op on an empty string (no note)', () => {
    const beat = resolveBeat(score, at)!
    beat.removeNote(resolveNote(score, at, 1)!) // string 1 now empty
    setSelectedHarmonic(model.HarmonicType.Natural)
    expect(store.getState().canUndo).toBe(false)
  })
})
