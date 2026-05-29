import type { model } from '@coderline/alphatab'
import type { Command } from '../CommandStack'
import { resolveBeat, type BeatRef } from '../selection'
import { ScoreMutator, resolveNote } from '../ScoreMutator'
import { execute } from '../HistoryRouter'
import { store } from '../store'

/**
 * Remove the note on the selected string only (the beat keeps its other notes). Captures the
 * Note OBJECT (not just string/fret) and re-adds the same object on undo, so any effects ride
 * along for free — the same reference trick DeleteBeat uses. `addNote` appends; the snapshot
 * sorts by string, so array position need not be restored.
 */
export class DeleteNoteCommand implements Command {
  private removed: model.Note | null = null
  private at: BeatRef
  private stringIndex: number

  constructor(at: BeatRef, stringIndex: number) {
    this.at = at
    this.stringIndex = stringIndex
  }

  apply(score: model.Score): void {
    const note = resolveNote(score, this.at, this.stringIndex)
    if (!note) return
    this.removed = note
    new ScoreMutator(score).removeNote(this.at, note)
  }

  undo(score: model.Score): void {
    if (!this.removed) return
    new ScoreMutator(score).restoreNote(this.at, this.removed)
  }

  describe(): string {
    return `Delete note on string ${this.stringIndex}`
  }
}

/**
 * Clear all notes from the beat → it becomes a rest (`Beat.isRest` is just `notes.length === 0`,
 * no special rest object). Captures every removed Note object and re-adds them all on undo.
 */
export class BeatToRestCommand implements Command {
  private removed: model.Note[] | null = null
  private at: BeatRef

  constructor(at: BeatRef) {
    this.at = at
  }

  apply(score: model.Score): void {
    const removed = new ScoreMutator(score).clearBeat(this.at)
    this.removed = removed.length > 0 ? removed : null
  }

  undo(score: model.Score): void {
    if (!this.removed) return
    const mutator = new ScoreMutator(score)
    for (const note of this.removed) mutator.restoreNote(this.at, note)
  }

  describe(): string {
    return `Clear beat ${this.at.beatIndex} to a rest`
  }
}

/** Delete the note on the current selection's string. No-op (no command pushed) if there's none. */
export function deleteSelectedNote(): void {
  const { selection, selectedString, api } = store.getState()
  if (!selection || !api?.score) return
  if (!resolveNote(api.score, selection, selectedString)) return
  execute(new DeleteNoteCommand(selection, selectedString))
}

/** Clear the selected beat to a rest. No-op if there's no selection or the beat is already empty. */
export function beatToRest(): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  const beat = resolveBeat(api.score, selection)
  if (!beat || beat.notes.length === 0) return
  execute(new BeatToRestCommand(selection))
}
