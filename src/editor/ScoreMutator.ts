import type { model } from '@coderline/alphatab'
import { resolveBeat, type BeatRef } from './selection'

/**
 * The single resolution point between an opaque `BeatRef` + string number and a live
 * alphaTab `Note`. Shared by Commands and tests so there's one implementation.
 *
 * `stringIndex` is 1-based (string 1 = lowest/bottom tab line), matching alphaTab's
 * `Note.string`. Returns `null` if the beat doesn't exist or carries no note on that string
 * (e.g. a rest, or a string that isn't fretted on this beat).
 */
export function resolveNote(
  score: model.Score,
  at: BeatRef,
  stringIndex: number,
): model.Note | null {
  const beat = resolveBeat(score, at)
  if (!beat) return null
  return beat.notes.find((n) => n.string === stringIndex) ?? null
}

/**
 * Thin ergonomic wrapper over alphaTab's Score model. Phase 2 ships only `changeFret`;
 * Phase 3 grows the rest (`addNote`, `deleteNote`, `changeDuration`, …). Commands construct
 * a short-lived mutator over the score they're handed in `apply`/`undo`.
 */
export class ScoreMutator {
  private score: model.Score

  constructor(score: model.Score) {
    this.score = score
  }

  changeFret(at: BeatRef, stringIndex: number, fret: number): void {
    const note = resolveNote(this.score, at, stringIndex)
    if (note) note.fret = fret
  }
}
