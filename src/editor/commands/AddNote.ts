import { model } from '@coderline/alphatab'
import type { Command } from '../CommandStack'
import type { BeatRef } from '../selection'
import { resolveBeat } from '../selection'
import { ScoreMutator } from '../ScoreMutator'

/** A fret-bearing command whose target value the multi-digit amend window can grow in place. */
export interface FretAmendable extends Command {
  readonly currentFret: number
  setFret(fret: number): void
}

/**
 * Add a note on an EMPTY string of an existing beat (chord build). No-op if the string is already
 * occupied — the dispatcher routes that keystroke to ChangeFret instead, so this command is only
 * ever issued against a free string. Amendable like ChangeFret: re-apply after the amend mutates
 * the fret of the note we added rather than no-opping on the now-occupied string.
 */
export class AddNoteCommand implements FretAmendable {
  private added: model.Note | null = null
  private at: BeatRef
  private stringIndex: number
  private fret: number

  constructor(at: BeatRef, stringIndex: number, fret: number) {
    this.at = at
    this.stringIndex = stringIndex
    this.fret = fret
  }

  get currentFret(): number {
    return this.fret
  }

  setFret(fret: number): void {
    this.fret = fret
  }

  apply(score: model.Score): void {
    const beat = resolveBeat(score, this.at)
    if (!beat) return
    if (this.added) {
      // Re-apply with a note we already created. Two shapes:
      //  - amend: the note is still on the string (no undo since apply) → just update its fret.
      //  - redo: a prior undo removed it from the beat → put the SAME object back, then set fret.
      // Discriminate by presence. (Executing any new command clears the redo stack, so after an
      // undo the string is reliably free until redo — this can't false-trigger the re-add branch.)
      this.added.fret = this.fret
      if (!beat.getNoteOnString(this.stringIndex)) {
        new ScoreMutator(score).restoreNote(this.at, this.added)
      }
      return
    }
    if (beat.getNoteOnString(this.stringIndex)) return // occupied by a pre-existing note → no-op
    this.added = new ScoreMutator(score).addNote(this.at, this.stringIndex, this.fret)
  }

  undo(score: model.Score): void {
    if (!this.added) return
    new ScoreMutator(score).removeNote(this.at, this.added)
  }

  describe(): string {
    return `Add note fret ${this.fret} on string ${this.stringIndex}`
  }
}
