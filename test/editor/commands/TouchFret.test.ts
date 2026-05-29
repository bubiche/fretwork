import { describe, it, expect, beforeEach } from 'vitest'
import { TouchFretCommand, touchSelectedFret } from '../../../src/editor/commands'
import { execute, undo, redo, clearHistory } from '../../../src/editor/HistoryRouter'
import { scoreSnapshot } from '../../../src/editor/snapshot'
import { store } from '../../../src/editor/store'
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

// Done-when #6: the headline invariant. Pure command against a synthesised Score — no store, no
// router, no reset hygiene to depend on. Touch writes the same fret back, so this passes
// trivially by design (PHASE_2.md: the trivial pass IS the green light for Phase 3). Phase 3's
// ChangeFretCommand makes apply change the snapshot and undo restore it — same test, real teeth.
describe('TouchFretCommand (pure apply/undo)', () => {
  it('apply then undo leaves the snapshot deep-equal to the original', () => {
    const score = makeMinimalScore()
    const original = scoreSnapshot(score)

    const cmd = new TouchFretCommand(beat0, 1)
    cmd.apply(score)
    expect(scoreSnapshot(score)).toEqual(original) // no-op write
    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('apply on a string with no note is a silent no-op (no throw, no change)', () => {
    const score = makeMinimalScore({ strings: 6 })
    const original = scoreSnapshot(score)
    const cmd = new TouchFretCommand(beat0, 7) // 7th string doesn't exist
    expect(() => cmd.apply(score)).not.toThrow()
    expect(() => cmd.undo(score)).not.toThrow()
    expect(scoreSnapshot(score)).toEqual(original)
  })
})

// Slice C plumbing test: the architecture smoke test. Drives the singleton router + store, so
// reset both before each test. scoreVersion is monotonic by design (clearHistory never resets
// it), so assert the delta, never an absolute value.
describe('HistoryRouter pipeline (Touch plumbing)', () => {
  let score: ReturnType<typeof makeMinimalScore>

  beforeEach(() => {
    clearHistory()
    score = makeMinimalScore()
    // afterMutation calls api.render(); the fake must provide it.
    store.setState({
      api: { score, render() {} } as unknown as AlphaTabApi,
      selection: beat0,
      selectedString: 1,
      canUndo: false,
      canRedo: false,
    })
  })

  it('execute grows the stack, flips canUndo, and bumps scoreVersion', () => {
    const version = store.getState().scoreVersion
    execute(new TouchFretCommand(beat0, 1))
    expect(store.getState().canUndo).toBe(true)
    expect(store.getState().canRedo).toBe(false)
    expect(store.getState().scoreVersion).toBe(version + 1)
  })

  it('undo flips canUndo off, canRedo on, and bumps scoreVersion again', () => {
    execute(new TouchFretCommand(beat0, 1))
    const version = store.getState().scoreVersion
    undo()
    expect(store.getState().canUndo).toBe(false)
    expect(store.getState().canRedo).toBe(true)
    expect(store.getState().scoreVersion).toBe(version + 1)
  })

  it('redo restores canUndo and bumps scoreVersion', () => {
    execute(new TouchFretCommand(beat0, 1))
    undo()
    const version = store.getState().scoreVersion
    redo()
    expect(store.getState().canUndo).toBe(true)
    expect(store.getState().canRedo).toBe(false)
    expect(store.getState().scoreVersion).toBe(version + 1)
  })

  it('touchSelectedFret on a note dispatches a command', () => {
    touchSelectedFret()
    expect(store.getState().canUndo).toBe(true)
  })

  it('touchSelectedFret on a string with no note pushes nothing', () => {
    store.setState({ selectedString: 7 }) // no 7th string
    touchSelectedFret()
    expect(store.getState().canUndo).toBe(false)
  })

  it('touchSelectedFret with no selection pushes nothing', () => {
    store.setState({ selection: null })
    touchSelectedFret()
    expect(store.getState().canUndo).toBe(false)
  })
})
