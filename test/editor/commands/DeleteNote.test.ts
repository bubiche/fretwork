import { describe, it, expect } from 'vitest'
import { DeleteNoteCommand, BeatToRestCommand } from '../../../src/editor/commands'
import { scoreSnapshot } from '../../../src/editor/snapshot'
import { resolveNote } from '../../../src/editor/ScoreMutator'
import { resolveBeat } from '../../../src/editor/selection'
import type { BeatRef } from '../../../src/editor/selection'
import { makeMinimalScore } from '../../fixtures/makeMinimalScore'

const beat0: BeatRef = { trackIndex: 0, staffIndex: 0, voiceIndex: 0, barIndex: 0, beatIndex: 0 }

describe('DeleteNoteCommand', () => {
  it('removes only the selected string; the beat keeps its other notes; undo restores', () => {
    const score = makeMinimalScore({ strings: 6 })
    const original = scoreSnapshot(score)

    const cmd = new DeleteNoteCommand(beat0, 3)
    cmd.apply(score)
    expect(resolveNote(score, beat0, 3)).toBeNull()
    expect(resolveBeat(score, beat0)!.notes).toHaveLength(5) // others survive
    expect(scoreSnapshot(score)).not.toEqual(original)

    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original) // sort-normalized, so append order is fine
  })

  it('is a silent no-op when the string has no note', () => {
    const score = makeMinimalScore({ strings: 6 })
    const original = scoreSnapshot(score)
    const cmd = new DeleteNoteCommand(beat0, 7) // no 7th string
    cmd.apply(score)
    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
  })
})

describe('BeatToRestCommand', () => {
  it('clears all notes → the beat becomes a rest; undo restores every note', () => {
    const score = makeMinimalScore({ strings: 6 })
    const original = scoreSnapshot(score)
    const beat = resolveBeat(score, beat0)!

    const cmd = new BeatToRestCommand(beat0)
    cmd.apply(score)
    expect(beat.notes).toHaveLength(0)
    expect(beat.isRest).toBe(true)

    cmd.undo(score)
    expect(beat.notes).toHaveLength(6)
    expect(beat.isRest).toBe(false)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('is a silent no-op on an already-empty beat', () => {
    const score = makeMinimalScore({ strings: 6 })
    const beat = resolveBeat(score, beat0)!
    for (const n of [...beat.notes]) beat.removeNote(n) // already a rest
    const original = scoreSnapshot(score)

    const cmd = new BeatToRestCommand(beat0)
    cmd.apply(score)
    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
  })
})
