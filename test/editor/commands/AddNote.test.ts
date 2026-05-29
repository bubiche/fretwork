import { describe, it, expect, beforeEach } from 'vitest'
import { AddNoteCommand, changeSelectedFret, resetFretAmend } from '../../../src/editor/commands'
import { execute, undo, redo, clearHistory } from '../../../src/editor/HistoryRouter'
import { scoreSnapshot } from '../../../src/editor/snapshot'
import { resolveNote } from '../../../src/editor/ScoreMutator'
import { resolveBeat } from '../../../src/editor/selection'
import { store } from '../../../src/editor/store'
import type { BeatRef } from '../../../src/editor/selection'
import { makeMinimalScore } from '../../fixtures/makeMinimalScore'
import type { AlphaTabApi } from '@coderline/alphatab'

const beat0: BeatRef = { trackIndex: 0, staffIndex: 0, voiceIndex: 0, barIndex: 0, beatIndex: 0 }

describe('AddNoteCommand (pure apply/undo)', () => {
  it('adds a note to an empty string; undo removes it', () => {
    const score = makeMinimalScore({ strings: 6 })
    const beat = resolveBeat(score, beat0)!
    beat.removeNote(beat.getNoteOnString(4)!) // free up string 4
    const original = scoreSnapshot(score)

    const cmd = new AddNoteCommand(beat0, 4, 9)
    cmd.apply(score)
    expect(resolveNote(score, beat0, 4)!.fret).toBe(9)
    expect(scoreSnapshot(score)).not.toEqual(original)

    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('is a no-op on an occupied string (never overwrites)', () => {
    const score = makeMinimalScore({ strings: 6 })
    const priorFret = resolveNote(score, beat0, 4)!.fret
    const original = scoreSnapshot(score)
    const cmd = new AddNoteCommand(beat0, 4, 99) // string 4 already has a note
    cmd.apply(score)
    expect(resolveNote(score, beat0, 4)!.fret).toBe(priorFret) // untouched
    expect(scoreSnapshot(score)).toEqual(original)
    cmd.undo(score) // added === null → no-op
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('re-apply after a fret amend updates the added note rather than no-opping', () => {
    const score = makeMinimalScore({ strings: 6 })
    const beat = resolveBeat(score, beat0)!
    beat.removeNote(beat.getNoteOnString(4)!)
    const cmd = new AddNoteCommand(beat0, 4, 1)
    cmd.apply(score) // adds fret 1; string 4 now occupied (by us)
    cmd.setFret(12)
    cmd.apply(score) // re-apply must update OUR note to 12, not skip on the occupied string
    expect(resolveNote(score, beat0, 4)!.fret).toBe(12)
    expect(beat.notes.filter((n) => n.string === 4)).toHaveLength(1) // no duplicate
  })
})

// The dispatcher routes a digit on an EMPTY string to AddNote, and a follow-up digit must amend it
// (so you can type a two-digit fret onto a fresh string). Drives the singleton stack/store.
describe('changeSelectedFret → AddNote routing + amend', () => {
  let score: ReturnType<typeof makeMinimalScore>

  beforeEach(() => {
    clearHistory()
    resetFretAmend()
    score = makeMinimalScore({ strings: 6 })
    const beat = resolveBeat(score, beat0)!
    beat.removeNote(beat.getNoteOnString(5)!) // string 5 empty → AddNote target
    store.setState({
      api: { score, render() {} } as unknown as AlphaTabApi,
      selection: beat0,
      selectedString: 5,
      canUndo: false,
      canRedo: false,
    })
  })

  it('a digit on an empty string adds a note (chord build)', () => {
    changeSelectedFret(7)
    expect(resolveNote(score, beat0, 5)!.fret).toBe(7)
    expect(store.getState().canUndo).toBe(true)
  })

  it('add-then-digit amends to a two-digit fret as one undo entry', () => {
    changeSelectedFret(1)
    changeSelectedFret(2) // must amend the AddNote, not re-route to ChangeFret on the now-filled string
    expect(resolveNote(score, beat0, 5)!.fret).toBe(12)
    undo() // single undo removes the whole note
    expect(resolveNote(score, beat0, 5)).toBeNull()
    expect(store.getState().canUndo).toBe(false)
  })

  it('undo then redo re-adds the note (regression: redo must not silently drop it)', () => {
    changeSelectedFret(7)
    expect(resolveNote(score, beat0, 5)!.fret).toBe(7)

    undo()
    expect(resolveNote(score, beat0, 5)).toBeNull()

    redo() // must put the note back on the string, not just touch a detached object
    expect(resolveNote(score, beat0, 5)!.fret).toBe(7)
    expect(store.getState().canUndo).toBe(true)
    expect(store.getState().canRedo).toBe(false)

    // And undo after redo must cleanly remove it again — proves no stale/duplicate state lingers.
    undo()
    expect(resolveNote(score, beat0, 5)).toBeNull()
  })
})
