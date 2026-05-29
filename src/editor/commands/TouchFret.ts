import type { model } from '@coderline/alphatab'
import type { Command } from '../CommandStack'
import type { BeatRef } from '../selection'
import { ScoreMutator, resolveNote } from '../ScoreMutator'
import { execute } from '../HistoryRouter'
import { store } from '../store'

/**
 * The Phase 2 no-op edit. Reads the selected note's fret and writes the same value back through
 * `ScoreMutator.changeFret`; undo writes the captured prior value (identical). The value never
 * changes — the deliverable is the path Command → ScoreMutator → Note. Phase 3's
 * `ChangeFretCommand` is this class with a `newFret` parameter instead of `note.fret`.
 */
export class TouchFretCommand implements Command {
  private prior: number | null = null
  private at: BeatRef
  private stringIndex: number

  constructor(at: BeatRef, stringIndex: number) {
    this.at = at
    this.stringIndex = stringIndex
  }

  apply(score: model.Score): void {
    const note = resolveNote(score, this.at, this.stringIndex)
    if (!note) return
    this.prior = note.fret
    new ScoreMutator(score).changeFret(this.at, this.stringIndex, note.fret)
  }

  undo(score: model.Score): void {
    if (this.prior == null) return
    new ScoreMutator(score).changeFret(this.at, this.stringIndex, this.prior)
  }

  describe(): string {
    return `Touch fret on beat ${this.at.beatIndex}`
  }
}

/**
 * Dispatch a Touch on the current selection. The guard here — not in the command — enforces
 * the spec's rule that a rest beat (or a string with no note) is a silent no-op that does NOT
 * push an empty Command. Without a note there's nothing to touch, so `canUndo` is unchanged.
 */
export function touchSelectedFret(): void {
  const { selection, selectedString, api } = store.getState()
  if (!selection || !api?.score) {
    if (import.meta.env.DEV) console.info('[touch] skipped: no selection')
    return
  }
  if (!resolveNote(api.score, selection, selectedString)) {
    if (import.meta.env.DEV) {
      console.info(`[touch] skipped: no note on string ${selectedString} of selected beat`)
    }
    return
  }
  execute(new TouchFretCommand(selection, selectedString))
}
