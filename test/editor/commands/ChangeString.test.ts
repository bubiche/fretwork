import { describe, it, expect } from 'vitest'
import { ChangeStringCommand } from '../../../src/editor/commands'
import { scoreSnapshot } from '../../../src/editor/snapshot'
import { resolveNote } from '../../../src/editor/ScoreMutator'
import { resolveBeat } from '../../../src/editor/selection'
import type { BeatRef } from '../../../src/editor/selection'
import { makeMinimalScore } from '../../fixtures/makeMinimalScore'

const beat0: BeatRef = { trackIndex: 0, staffIndex: 0, voiceIndex: 0, barIndex: 0, beatIndex: 0 }

describe('ChangeStringCommand', () => {
  it('moves a note to a free string, preserving fret, and undo restores it', () => {
    // 3 strings, 1 note per string → no free string. Use a beat with a gap instead.
    const score = makeMinimalScore({ strings: 6 })
    const beat = resolveBeat(score, beat0)!
    // Vacate string 4 so it's a valid move target.
    beat.removeNote(beat.getNoteOnString(4)!)
    const original = scoreSnapshot(score)
    const fret = resolveNote(score, beat0, 3)!.fret

    const cmd = new ChangeStringCommand(beat0, 3, 4)
    cmd.apply(score)

    expect(resolveNote(score, beat0, 3)).toBeNull()
    expect(resolveNote(score, beat0, 4)!.fret).toBe(fret)
    // noteStringLookup must be consistent: getNoteOnString reads it.
    expect(beat.getNoteOnString(4)).not.toBeNull()
    expect(beat.getNoteOnString(3)).toBeNull()

    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
    expect(beat.getNoteOnString(3)).not.toBeNull()
    expect(beat.getNoteOnString(4)).toBeNull()
  })

  it('is a no-op when the target string is occupied', () => {
    const score = makeMinimalScore({ strings: 6 }) // every string occupied
    const original = scoreSnapshot(score)
    const cmd = new ChangeStringCommand(beat0, 3, 4) // 4 is occupied
    cmd.apply(score)
    expect(scoreSnapshot(score)).toEqual(original) // nothing moved
    cmd.undo(score) // must also no-op (moved === false)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('is a no-op when there is no note on the source string', () => {
    const score = makeMinimalScore({ strings: 6 })
    const beat = resolveBeat(score, beat0)!
    beat.removeNote(beat.getNoteOnString(2)!) // string 2 empty
    const original = scoreSnapshot(score)
    const cmd = new ChangeStringCommand(beat0, 2, 1) // nothing on 2 (and 1 occupied anyway)
    cmd.apply(score)
    cmd.undo(score)
    expect(scoreSnapshot(score)).toEqual(original)
  })
})
