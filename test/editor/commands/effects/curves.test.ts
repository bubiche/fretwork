import { describe, it, expect, beforeEach } from 'vitest'
import { model, Settings } from '@coderline/alphatab'
import type { AlphaTabApi } from '@coderline/alphatab'
import {
  SetBendCommand,
  SetWhammyCommand,
  BEND_PRESETS,
  WHAMMY_PRESETS,
  setSelectedBend,
  clearSelectedBend,
  setSelectedWhammy,
  clearSelectedWhammy,
} from '../../../../src/editor/commands'
import { scoreSnapshot } from '../../../../src/editor/snapshot'
import { resolveNote } from '../../../../src/editor/ScoreMutator'
import { resolveBeat } from '../../../../src/editor/selection'
import { store } from '../../../../src/editor/store'
import { clearHistory } from '../../../../src/editor/HistoryRouter'
import type { BeatRef } from '../../../../src/editor/selection'
import { makeMinimalScore } from '../../../fixtures/makeMinimalScore'

// PHASE_4 §testing point 2: bend/whammy need a finish()-DRIVEN test — finish() may mutate the points
// array, so the round-trip must run apply → finish → undo → finish and assert the array (and the
// derived render caches) are restored EXACTLY. (Empirically 1.8.2 leaves these recipes untouched;
// the deep-copy-and-restore in the commands is correct either way, which is what these tests prove.)

const ref = (beatIndex: number): BeatRef => ({
  trackIndex: 0,
  staffIndex: 0,
  voiceIndex: 0,
  barIndex: 0,
  beatIndex,
})

const finish = (score: model.Score) => score.finish(new Settings())

function twoBeatScore() {
  const score = makeMinimalScore({ bars: 1, beatsPerBar: 2, strings: 6 })
  finish(score)
  return score
}

const fullStep = BEND_PRESETS.find((p) => p.id === 'full')!
const bendRelease = BEND_PRESETS.find((p) => p.id === 'bendRelease')!
const dive = WHAMMY_PRESETS.find((p) => p.id === 'dive')!
const diveReturn = WHAMMY_PRESETS.find((p) => p.id === 'diveReturn')!

describe('SetBendCommand: apply/finish/undo restores points + caches', () => {
  it('applies a full-step bend and restores exactly on undo (after finish)', () => {
    const score = twoBeatScore()
    const original = scoreSnapshot(score)
    const at = ref(0)

    const cmd = new SetBendCommand(at, 1, fullStep.bendType, fullStep.points)
    cmd.apply(score)
    finish(score)

    const note = resolveNote(score, at, 1)!
    expect(note.hasBend).toBe(true)
    expect(note.bendType).toBe(model.BendType.Bend)
    expect(note.bendPoints!.map((p) => [p.offset, p.value])).toEqual([
      [0, 0],
      [30, 4],
      [60, 4],
    ])
    // addBendPoint maintained the renderer's max cache (finish() does NOT recompute it).
    expect(note.maxBendPoint!.value).toBe(4)
    // value/2 = semitones → full step is 2 semitones.
    expect(note.initialBendValue).toBe(0) // first point value 0 → no prebend

    cmd.undo(score)
    finish(score) // the re-finish that would re-mutate a leaky array
    const restored = resolveNote(score, at, 1)!
    expect(restored.hasBend).toBe(false)
    expect(restored.bendType).toBe(model.BendType.None)
    expect(restored.bendPoints).toBeNull()
    expect(restored.maxBendPoint).toBeNull() // cache cleared, not stranded
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('replaces one bend preset with another, then undo restores the FIRST preset (not clean)', () => {
    const score = twoBeatScore()
    const at = ref(0)

    new SetBendCommand(at, 1, fullStep.bendType, fullStep.points).apply(score)
    finish(score)
    const snapAfterFull = scoreSnapshot(score)

    const cmd2 = new SetBendCommand(at, 1, bendRelease.bendType, bendRelease.points)
    cmd2.apply(score)
    finish(score)
    expect(resolveNote(score, at, 1)!.bendType).toBe(model.BendType.BendRelease)
    expect(resolveNote(score, at, 1)!.bendPoints).toHaveLength(4)

    cmd2.undo(score)
    finish(score)
    // Undo of the second command restores the full-step bend (the captured prior), proving the
    // capture grabbed the live prior state — not a clean note.
    expect(resolveNote(score, at, 1)!.bendType).toBe(model.BendType.Bend)
    expect(resolveNote(score, at, 1)!.maxBendPoint!.value).toBe(4)
    expect(scoreSnapshot(score)).toEqual(snapAfterFull)
  })

  it('redo re-applies the bend (capture-once survives undo→redo)', () => {
    const score = twoBeatScore()
    const at = ref(0)
    const cmd = new SetBendCommand(at, 1, fullStep.bendType, fullStep.points)
    cmd.apply(score)
    finish(score)
    cmd.undo(score)
    finish(score)
    cmd.apply(score) // redo
    finish(score)
    expect(resolveNote(score, at, 1)!.hasBend).toBe(true)
    expect(resolveNote(score, at, 1)!.bendPoints!.map((p) => p.value)).toEqual([0, 4, 4])
  })
})

describe('SetWhammyCommand: apply/finish/undo restores points + min/max caches', () => {
  it('applies a dive and restores exactly on undo (after finish)', () => {
    const score = twoBeatScore()
    const original = scoreSnapshot(score)
    const at = ref(0)

    const cmd = new SetWhammyCommand(at, dive.whammyType, dive.points)
    cmd.apply(score)
    finish(score)

    const beat = resolveBeat(score, at)!
    expect(beat.hasWhammyBar).toBe(true)
    expect(beat.whammyBarType).toBe(model.WhammyType.Dive)
    expect(beat.whammyBarPoints!.map((p) => [p.offset, p.value])).toEqual([
      [0, 0],
      [60, -4],
    ])
    // addWhammyBarPoint maintains BOTH caches; the dive value −4 is the min, 0 the max.
    expect(beat.minWhammyPoint!.value).toBe(-4)
    expect(beat.maxWhammyPoint!.value).toBe(0)

    cmd.undo(score)
    finish(score)
    const restored = resolveBeat(score, at)!
    expect(restored.hasWhammyBar).toBe(false)
    expect(restored.whammyBarType).toBe(model.WhammyType.None)
    expect(restored.whammyBarPoints).toBeNull()
    expect(restored.minWhammyPoint).toBeNull() // the cache the advisor flagged — not stranded
    expect(restored.maxWhammyPoint).toBeNull()
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('deep→shallow switch does not strand a stale min-dive cache', () => {
    const score = twoBeatScore()
    const at = ref(0)
    // diveReturn dips to −8, then dive only to −4. minWhammyPoint must follow down to −4, not keep −8.
    new SetWhammyCommand(at, diveReturn.whammyType, diveReturn.points).apply(score)
    finish(score)
    expect(resolveBeat(score, at)!.minWhammyPoint!.value).toBe(-8)

    new SetWhammyCommand(at, dive.whammyType, dive.points).apply(score)
    finish(score)
    expect(resolveBeat(score, at)!.minWhammyPoint!.value).toBe(-4) // reset, not stale −8
  })
})

// Dispatcher-level guards, mirroring linked.test.ts: the dispatchers are the panel↔command boundary,
// so their no-op rules (clear pushes nothing when there's nothing to clear; note-level no-ops on an
// empty string; whammy works beat-level with no string) need their own coverage against store state.
describe('curve dispatchers: no-op guards', () => {
  let score: ReturnType<typeof makeMinimalScore>
  const at = ref(0)

  beforeEach(() => {
    clearHistory()
    score = makeMinimalScore({ bars: 1, beatsPerBar: 2, strings: 6 })
    // Settings-less fake api (skips finish() in afterMutation; the model write still runs).
    store.setState({
      api: { score, render() {} } as unknown as AlphaTabApi,
      selection: at,
      selectedString: 1,
      canUndo: false,
      canRedo: false,
    })
  })

  it('clearSelectedBend: no-op (pushes nothing) when the note has no bend, removes when it does', () => {
    clearSelectedBend()
    expect(store.getState().canUndo).toBe(false) // nothing to clear

    setSelectedBend(fullStep)
    expect(store.getState().canUndo).toBe(true)
    expect(resolveNote(score, at, 1)!.hasBend).toBe(true)

    clearSelectedBend() // now there IS a bend → a real removal command
    expect(resolveNote(score, at, 1)!.hasBend).toBe(false)
  })

  it('setSelectedBend: no-op when the selected string carries no note', () => {
    store.setState({ selectedString: 1 })
    score.tracks[0].staves[0].bars[0].voices[0].beats[0].removeNote(resolveNote(score, at, 1)!)
    setSelectedBend(fullStep)
    expect(store.getState().canUndo).toBe(false) // empty string → dispatcher bails
  })

  it('setSelectedWhammy: applies beat-level with only a selection (no string needed)', () => {
    store.setState({ selectedString: 99 }) // no such string; whammy is beat-level so this is irrelevant
    setSelectedWhammy(dive)
    expect(store.getState().canUndo).toBe(true)
    expect(resolveBeat(score, at)!.hasWhammyBar).toBe(true)

    clearSelectedWhammy()
    expect(resolveBeat(score, at)!.hasWhammyBar).toBe(false)
  })
})
