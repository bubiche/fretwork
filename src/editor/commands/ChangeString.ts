import type { model } from '@coderline/alphatab'
import type { Command } from '../CommandStack'
import { resolveBeat, type BeatRef } from '../selection'
import { ScoreMutator, resolveNote } from '../ScoreMutator'
import { execute } from '../HistoryRouter'
import { store } from '../store'

/**
 * Move a note to an adjacent string, preserving its fret. Distinct from `↑`/`↓` which move the
 * *selection*; this moves the *note*. Mutates `note.string` in place AND fixes the beat's
 * `noteStringLookup` (via `ScoreMutator.changeString`). No-op if the source has no note or the
 * target string is occupied — recorded in `moved` so undo only reverses an edit that happened.
 */
export class ChangeStringCommand implements Command {
  private moved = false
  private at: BeatRef
  private fromString: number
  private toString: number

  constructor(at: BeatRef, fromString: number, toString: number) {
    this.at = at
    this.fromString = fromString
    this.toString = toString
  }

  apply(score: model.Score): void {
    this.moved = new ScoreMutator(score).changeString(this.at, this.fromString, this.toString)
  }

  undo(score: model.Score): void {
    if (!this.moved) return
    // The note now lives on toString and fromString is free again — move it straight back.
    new ScoreMutator(score).changeString(this.at, this.toString, this.fromString)
  }

  describe(): string {
    return `Move note from string ${this.fromString} to ${this.toString}`
  }
}

/**
 * Dispatch a note move from the current selection. `dy` matches `moveString`'s convention:
 * `-1` (Alt+↑) → visually up → higher string index; `+1` (Alt+↓) → lower. No-op (no command
 * pushed) if there's no note to move, the target is out of tuning range, or it's occupied. The
 * selected string follows the moved note so the overlay stays on it.
 */
export function moveSelectedNote(dy: -1 | 1): void {
  const { selection, selectedString, api } = store.getState()
  if (!selection || !api?.score) return
  const staff = api.score.tracks[selection.trackIndex]?.staves[selection.staffIndex]
  if (!staff) return
  const count = staff.tuning.length
  const target = selectedString + -dy
  if (target < 1 || target > count) return // off the fretboard
  if (!resolveNote(api.score, selection, selectedString)) return // nothing to move
  const beat = resolveBeat(api.score, selection)
  if (beat?.getNoteOnString(target)) return // occupied → no-op

  execute(new ChangeStringCommand(selection, selectedString, target))
  store.setState({ selectedString: target })
}
