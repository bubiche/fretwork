import { describe, it, expect, beforeEach } from 'vitest'
import { model } from '@coderline/alphatab'
import {
  ChangeDurationCommand,
  stepSelectedDuration,
  toggleSelectedDot,
} from '../../../src/editor/commands'
import { clearHistory } from '../../../src/editor/HistoryRouter'
import { scoreSnapshot } from '../../../src/editor/snapshot'
import { resolveBeat } from '../../../src/editor/selection'
import { store } from '../../../src/editor/store'
import type { BeatRef } from '../../../src/editor/selection'
import { makeMinimalScore } from '../../fixtures/makeMinimalScore'
import type { AlphaTabApi } from '@coderline/alphatab'

const beat0: BeatRef = { trackIndex: 0, staffIndex: 0, voiceIndex: 0, barIndex: 0, beatIndex: 0 }

describe('ChangeDurationCommand (pure apply/undo)', () => {
  it('changes duration; undo restores; carries relayout = voice', () => {
    const score = makeMinimalScore() // beats default to Quarter
    const original = scoreSnapshot(score)
    const cmd = new ChangeDurationCommand(beat0, model.Duration.Eighth, 0)
    expect(cmd.relayout).toBe('voice')

    cmd.apply(score)
    expect(resolveBeat(score, beat0)!.duration).toBe(model.Duration.Eighth)
    expect(scoreSnapshot(score)).not.toEqual(original)

    cmd.undo(score)
    expect(resolveBeat(score, beat0)!.duration).toBe(model.Duration.Quarter)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('toggles the dot and restores it on undo', () => {
    const score = makeMinimalScore()
    const cmd = new ChangeDurationCommand(beat0, model.Duration.Quarter, 1)
    cmd.apply(score)
    expect(resolveBeat(score, beat0)!.dots).toBe(1)
    cmd.undo(score)
    expect(resolveBeat(score, beat0)!.dots).toBe(0)
  })
})

describe('stepSelectedDuration / toggleSelectedDot (dispatchers)', () => {
  let score: ReturnType<typeof makeMinimalScore>

  beforeEach(() => {
    clearHistory()
    score = makeMinimalScore()
    // Settings-less fake api: ChangeDuration.relayout is 'voice', so afterMutation would try
    // finish() — its guard checks `api.settings` (undefined here), so it skips finish and just
    // bumps version + re-validates selection. The model edit still happens, which is what we test.
    store.setState({
      api: { score, render() {} } as unknown as AlphaTabApi,
      selection: beat0,
      selectedString: 1,
      canUndo: false,
      canRedo: false,
    })
  })

  it('`-` shortens Quarter → Eighth', () => {
    stepSelectedDuration(-1)
    expect(resolveBeat(score, beat0)!.duration).toBe(model.Duration.Eighth)
  })

  it('`+` lengthens Quarter → Half', () => {
    stepSelectedDuration(1)
    expect(resolveBeat(score, beat0)!.duration).toBe(model.Duration.Half)
  })

  it('clamps at Whole (cannot lengthen past it)', () => {
    resolveBeat(score, beat0)!.duration = model.Duration.Whole
    stepSelectedDuration(1)
    expect(resolveBeat(score, beat0)!.duration).toBe(model.Duration.Whole)
    expect(store.getState().canUndo).toBe(false) // no command pushed
  })

  it('clamps at ThirtySecond (cannot shorten past it)', () => {
    resolveBeat(score, beat0)!.duration = model.Duration.ThirtySecond
    stepSelectedDuration(-1)
    expect(resolveBeat(score, beat0)!.duration).toBe(model.Duration.ThirtySecond)
    expect(store.getState().canUndo).toBe(false)
  })

  it('toggleSelectedDot flips 0 → 1 → 0', () => {
    toggleSelectedDot()
    expect(resolveBeat(score, beat0)!.dots).toBe(1)
    toggleSelectedDot()
    expect(resolveBeat(score, beat0)!.dots).toBe(0)
  })
})
