import { describe, it, expect, beforeEach } from 'vitest'
import { model } from '@coderline/alphatab'
import type { AlphaTabApi } from '@coderline/alphatab'
import {
  SetNoteEffectCommand,
  SetBeatEffectCommand,
  cycleSelectedVibrato,
  stepSelectedDynamics,
} from '../../../../src/editor/commands'
import { resolveNote } from '../../../../src/editor/ScoreMutator'
import { resolveBeat } from '../../../../src/editor/selection'
import { store } from '../../../../src/editor/store'
import { clearHistory } from '../../../../src/editor/HistoryRouter'
import type { BeatRef } from '../../../../src/editor/selection'
import { makeMinimalScore } from '../../../fixtures/makeMinimalScore'

// Pure-command tests for the 4a articulation effects: apply SETS the field, undo RESTORES the
// prior. No finish() needed — these are value writes (the linked cluster's finish() behaviour is
// guarded separately in linked.test.ts). The capture-once `=== null` guard is the load-bearing
// detail: the "off" value is `false`/`0`, both falsy, so a truthiness guard would mis-capture.

const ref = (barIndex: number, beatIndex: number): BeatRef => ({
  trackIndex: 0,
  staffIndex: 0,
  voiceIndex: 0,
  barIndex,
  beatIndex,
})

describe('SetNoteEffectCommand (articulation)', () => {
  it('palm mute: apply sets true, undo restores false', () => {
    const score = makeMinimalScore()
    const at = ref(0, 0)
    const note = resolveNote(score, at, 1)!
    expect(note.isPalmMute).toBe(false)

    const cmd = new SetNoteEffectCommand(at, 1, 'isPalmMute', true, { relayout: 'voice' })
    cmd.apply(score)
    expect(resolveNote(score, at, 1)!.isPalmMute).toBe(true)
    cmd.undo(score)
    expect(resolveNote(score, at, 1)!.isPalmMute).toBe(false)
  })

  it('toggling OFF restores the prior true (capture-once does not mis-read false as uncaptured)', () => {
    const score = makeMinimalScore()
    const at = ref(0, 0)
    resolveNote(score, at, 1)!.isGhost = true // pre-existing effect

    const cmd = new SetNoteEffectCommand(at, 1, 'isGhost', false)
    cmd.apply(score)
    expect(resolveNote(score, at, 1)!.isGhost).toBe(false)
    cmd.undo(score)
    expect(resolveNote(score, at, 1)!.isGhost).toBe(true) // prior true restored, not clobbered
  })

  it('vibrato: apply sets the enum, undo restores None (enum 0 is a legal prior)', () => {
    const score = makeMinimalScore()
    const at = ref(0, 0)
    expect(resolveNote(score, at, 1)!.vibrato).toBe(model.VibratoType.None)

    const cmd = new SetNoteEffectCommand(at, 1, 'vibrato', model.VibratoType.Wide, { label: 'Vibrato' })
    cmd.apply(score)
    expect(resolveNote(score, at, 1)!.vibrato).toBe(model.VibratoType.Wide)
    cmd.undo(score)
    expect(resolveNote(score, at, 1)!.vibrato).toBe(model.VibratoType.None)
  })

  it('re-apply (redo) re-sets the value after an undo', () => {
    const score = makeMinimalScore()
    const at = ref(0, 0)
    const cmd = new SetNoteEffectCommand(at, 1, 'isDead', true)
    cmd.apply(score)
    cmd.undo(score)
    cmd.apply(score) // redo
    expect(resolveNote(score, at, 1)!.isDead).toBe(true)
  })

  it('no-op safe on an empty string (no note): apply/undo do nothing', () => {
    const score = makeMinimalScore({ strings: 6 })
    const at = ref(0, 0)
    const beat = resolveBeat(score, at)!
    const note = beat.notes.find((n) => n.string === 3)!
    beat.removeNote(note) // string 3 now empty
    const cmd = new SetNoteEffectCommand(at, 3, 'isPalmMute', true)
    expect(() => {
      cmd.apply(score)
      cmd.undo(score)
    }).not.toThrow()
    expect(resolveBeat(score, at)!.notes.find((n) => n.string === 3)).toBeUndefined()
  })
})

describe('SetBeatEffectCommand (dynamics, beat-level)', () => {
  it('apply sets the beat dynamics, undo restores the prior value', () => {
    const score = makeMinimalScore()
    const at = ref(0, 0)
    const prior = resolveBeat(score, at)!.dynamics

    const cmd = new SetBeatEffectCommand(at, 'dynamics', model.DynamicValue.FFF, { label: 'Dynamics' })
    cmd.apply(score)
    expect(resolveBeat(score, at)!.dynamics).toBe(model.DynamicValue.FFF)
    cmd.undo(score)
    expect(resolveBeat(score, at)!.dynamics).toBe(prior)
  })

  it('restores PPP (enum 0) prior correctly — falsy but legal', () => {
    const score = makeMinimalScore()
    const at = ref(0, 0)
    resolveBeat(score, at)!.dynamics = model.DynamicValue.PPP

    const cmd = new SetBeatEffectCommand(at, 'dynamics', model.DynamicValue.F)
    cmd.apply(score)
    cmd.undo(score)
    expect(resolveBeat(score, at)!.dynamics).toBe(model.DynamicValue.PPP)
  })
})

describe('cycleSelectedVibrato / stepSelectedDynamics (dispatchers)', () => {
  let score: ReturnType<typeof makeMinimalScore>
  const at = ref(0, 0)

  beforeEach(() => {
    clearHistory()
    score = makeMinimalScore()
    // Settings-less fake api: vibrato/dynamics carry relayout 'voice', so afterMutation would try
    // finish() — its guard checks `api.settings` (undefined here), so it skips finish and just bumps
    // version + re-validates selection. The model edit still happens, which is what we test. (Same
    // pattern as ChangeDuration's dispatcher tests.)
    store.setState({
      api: { score, render() {} } as unknown as AlphaTabApi,
      selection: at,
      selectedString: 1,
      canUndo: false,
      canRedo: false,
    })
  })

  it('cycleSelectedVibrato: None → Slight → Wide → None (wraps)', () => {
    expect(resolveNote(score, at, 1)!.vibrato).toBe(model.VibratoType.None)
    cycleSelectedVibrato()
    expect(resolveNote(score, at, 1)!.vibrato).toBe(model.VibratoType.Slight)
    cycleSelectedVibrato()
    expect(resolveNote(score, at, 1)!.vibrato).toBe(model.VibratoType.Wide)
    cycleSelectedVibrato()
    expect(resolveNote(score, at, 1)!.vibrato).toBe(model.VibratoType.None) // wrapped
  })

  it('stepSelectedDynamics: fresh beat (F) steps +1 → FF, −1 → MF', () => {
    expect(resolveBeat(score, at)!.dynamics).toBe(model.DynamicValue.F) // makeMinimalScore default
    stepSelectedDynamics(1)
    expect(resolveBeat(score, at)!.dynamics).toBe(model.DynamicValue.FF)
    stepSelectedDynamics(-1)
    expect(resolveBeat(score, at)!.dynamics).toBe(model.DynamicValue.F)
  })

  it('stepSelectedDynamics: clamps at FFF (loudest), pushing no command', () => {
    resolveBeat(score, at)!.dynamics = model.DynamicValue.FFF
    stepSelectedDynamics(1)
    expect(resolveBeat(score, at)!.dynamics).toBe(model.DynamicValue.FFF)
    expect(store.getState().canUndo).toBe(false) // no-op pushed nothing
  })

  it('stepSelectedDynamics: clamps at PPP (softest), pushing no command', () => {
    resolveBeat(score, at)!.dynamics = model.DynamicValue.PPP
    stepSelectedDynamics(-1)
    expect(resolveBeat(score, at)!.dynamics).toBe(model.DynamicValue.PPP)
    expect(store.getState().canUndo).toBe(false)
  })
})
