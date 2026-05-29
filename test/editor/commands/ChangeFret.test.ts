import { describe, it, expect, beforeEach } from 'vitest'
import {
  ChangeFretCommand,
  changeSelectedFret,
  resetFretAmend,
  MAX_FRET,
} from '../../../src/editor/commands'
import { execute, undo, redo, clearHistory } from '../../../src/editor/HistoryRouter'
import { scoreSnapshot } from '../../../src/editor/snapshot'
import { store } from '../../../src/editor/store'
import { resolveNote } from '../../../src/editor/ScoreMutator'
import type { BeatRef } from '../../../src/editor/selection'
import { makeMinimalScore } from '../../fixtures/makeMinimalScore'
import type { AlphaTabApi } from '@coderline/alphatab'

const beat0: BeatRef = {
  trackIndex: 0,
  staffIndex: 0,
  voiceIndex: 0,
  barIndex: 0,
  beatIndex: 0,
}

// Done-when #6, with real teeth (unlike the Touch no-op): apply CHANGES the snapshot, undo
// RESTORES it deep-equal. The "apply changes the snapshot" half is precisely what Phase 2 could
// not test because Touch wrote the same value back.
describe('ChangeFretCommand (pure apply/undo)', () => {
  it('apply changes the snapshot; undo restores it deep-equal', () => {
    const score = makeMinimalScore()
    const original = scoreSnapshot(score)
    // string-1/beat-0 seeds to fret 1; pick a different value so apply genuinely changes state.
    const cmd = new ChangeFretCommand(beat0, 1, 7)

    cmd.apply(score)
    expect(scoreSnapshot(score)).not.toEqual(original)
    expect(resolveNote(score, beat0, 1)!.fret).toBe(7)

    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('captures the prior fret once, so re-apply after a value change still undoes to the original', () => {
    const score = makeMinimalScore() // string-1/beat-0 fret = 1
    const original = scoreSnapshot(score)
    const cmd = new ChangeFretCommand(beat0, 1, 1)

    cmd.apply(score) // fret 1
    cmd.setFret(12) // simulate the amend mutating the value
    cmd.apply(score) // re-apply: must NOT recapture prior as 1
    expect(resolveNote(score, beat0, 1)!.fret).toBe(12)

    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original) // restores the true original (1), not 1-as-amended
  })

  it('fret 0 is a legal prior (the capture guard uses === null, not falsiness)', () => {
    const score = makeMinimalScore()
    resolveNote(score, beat0, 1)!.fret = 0 // seed prior = 0
    const cmd = new ChangeFretCommand(beat0, 1, 5)
    cmd.apply(score)
    expect(resolveNote(score, beat0, 1)!.fret).toBe(5)
    cmd.undo(score)
    expect(resolveNote(score, beat0, 1)!.fret).toBe(0) // not clobbered by the second-apply guard
  })

  it('apply on a string with no note is a silent no-op', () => {
    const score = makeMinimalScore({ strings: 6 })
    const original = scoreSnapshot(score)
    const cmd = new ChangeFretCommand(beat0, 7, 5) // no 7th string
    expect(() => cmd.apply(score)).not.toThrow()
    expect(() => cmd.undo(score)).not.toThrow()
    expect(scoreSnapshot(score)).toEqual(original)
  })
})

// The multi-digit amend window lives in the dispatcher + HistoryRouter, so these drive the
// singleton stack/store. Reset both (and the module-level amend pointer) before each test.
describe('changeSelectedFret (multi-digit amend window)', () => {
  let score: ReturnType<typeof makeMinimalScore>

  beforeEach(() => {
    clearHistory()
    resetFretAmend()
    score = makeMinimalScore()
    store.setState({
      api: { score, render() {} } as unknown as AlphaTabApi,
      selection: beat0,
      selectedString: 1,
      canUndo: false,
      canRedo: false,
    })
  })

  it('a single digit sets the fret and pushes one undo entry', () => {
    changeSelectedFret(5)
    expect(resolveNote(score, beat0, 1)!.fret).toBe(5)
    expect(store.getState().canUndo).toBe(true)
  })

  it('two fast digits combine to a two-digit fret as ONE undo entry', () => {
    changeSelectedFret(1)
    changeSelectedFret(2) // within the window (no time passes in the test → same ms)
    expect(resolveNote(score, beat0, 1)!.fret).toBe(12)

    undo() // a single undo must clear the whole 12, proving it's one entry
    expect(store.getState().canUndo).toBe(false)
    expect(resolveNote(score, beat0, 1)!.fret).toBe(1) // seeded original
  })

  it('clamps a combined value over the max to MAX_FRET', () => {
    changeSelectedFret(9)
    changeSelectedFret(9) // 99 → clamp
    expect(resolveNote(score, beat0, 1)!.fret).toBe(MAX_FRET)
  })

  it('does NOT amend a command that is no longer the top of the stack (1 → undo → 2)', () => {
    changeSelectedFret(1) // depth 1, fret 1
    undo() // command leaves the undo stack; fret restored to original (1)
    expect(store.getState().canUndo).toBe(false)

    changeSelectedFret(2) // must start fresh, NOT amend the popped command
    expect(resolveNote(score, beat0, 1)!.fret).toBe(2) // fresh fret 2, not 12, no corruption
    expect(store.getState().canUndo).toBe(true)
    expect(store.getState().canRedo).toBe(false) // a fresh execute clears the redo buffer
  })

  it('a digit on a different string starts a fresh command (no cross-target amend)', () => {
    changeSelectedFret(1) // string 1 → fret 1
    store.setState({ selectedString: 2 })
    changeSelectedFret(3) // string 2 → fret 3, fresh entry
    expect(resolveNote(score, beat0, 1)!.fret).toBe(1)
    expect(resolveNote(score, beat0, 2)!.fret).toBe(3)

    undo() // undoes only the string-2 edit
    expect(resolveNote(score, beat0, 2)!.fret).toBe(2) // seeded original (bar0*100 + beat0*10 + 2)
    expect(resolveNote(score, beat0, 1)!.fret).toBe(1) // string-1 edit survives
  })

  it('redo re-applies an undone fret edit', () => {
    changeSelectedFret(5)
    undo()
    expect(resolveNote(score, beat0, 1)!.fret).toBe(1)
    redo()
    expect(resolveNote(score, beat0, 1)!.fret).toBe(5)
  })
})
