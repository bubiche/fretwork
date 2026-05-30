import { model } from '@coderline/alphatab'
import type { Command } from '../../CommandStack'
import { store } from '../../store'
import { ScoreMutator, resolveNote } from '../../ScoreMutator'
import { resolveVoice, type BeatRef } from '../../selection'
import { execute } from '../../HistoryRouter'

/**
 * Phase 4b-2 — grace notes. Unlike the other effects this is **not** a field write: a real GP grace
 * note is a *separate* small beat inserted BEFORE the main one (`displayDuration 0`, so it borrows no
 * bar time), carrying its own pitch. Verified against `sample_harmonic.gp4` (bar 185: quarter →
 * grace-8th → half) and confirmed `finish()` does NOT clobber the grace beat's pitch (unlike a tie),
 * so undo is a clean removal — no pitch teardown.
 *
 * The owner chose this composite over flag-toggling `beat.graceType` on the selected beat (which would
 * convert the user's beat itself into a grace note, stripping its rhythmic value — semantically wrong).
 *
 * Shape mirrors {@link AddNoteCommand}'s cached-object redo + {@link InsertBeatCommand}'s by-reference
 * undo: build the grace beat once (capturing the selected note's pitch), insert it at the selection's
 * array position (pushing the main beat to +1), and on undo splice it back out by reference. Redo
 * re-inserts the SAME beat object, so identity (and its pitch) survives undo→redo. `relayout: 'voice'`
 * — a structural edit that needs reindex/re-chain (and finish() to set `displayDuration`).
 */
export class InsertGraceBeatCommand implements Command {
  readonly relayout = 'voice' as const
  private graceBeat: model.Beat | null = null
  private captured = false
  private at: BeatRef
  private stringIndex: number
  private graceType: model.GraceType

  constructor(at: BeatRef, stringIndex: number, graceType: model.GraceType = model.GraceType.BeforeBeat) {
    this.at = at
    this.stringIndex = stringIndex
    this.graceType = graceType
  }

  apply(score: model.Score): void {
    if (!this.captured) {
      // The grace note copies the selected note's pitch — so it no-ops on an empty string (no pitch
      // to ornament). Captured once; redo re-inserts the same beat without rebuilding.
      const note = resolveNote(score, this.at, this.stringIndex)
      this.captured = true
      if (!note) return
      const grace = new model.Beat()
      grace.duration = model.Duration.Eighth // grace notes render as small eighths (matches the fixture)
      grace.graceType = this.graceType
      const gn = new model.Note()
      gn.string = note.string
      gn.fret = note.fret
      grace.addNote(gn)
      this.graceBeat = grace
    }
    if (!this.graceBeat) return
    // Splice at the selection's index → the grace lands BEFORE it, the main beat shifts to +1.
    // reinsertBeat (re)sets beat.voice and covers index 0; finish() fixes index/chain.
    new ScoreMutator(score).reinsertBeat(this.at, this.at.beatIndex, this.graceBeat)
  }

  undo(score: model.Score): void {
    if (!this.graceBeat) return
    const voice = resolveVoice(score, this.at)
    if (!voice) return
    const i = voice.beats.indexOf(this.graceBeat)
    if (i >= 0) voice.beats.splice(i, 1)
  }

  describe(): string {
    return `Grace note before beat ${this.at.beatIndex}`
  }
}

/** The grace placements the panel offers. There's no "None"/remove item — grace is **add-only via the
 *  panel** in 4b-2 (remove with undo). NB this is a SCOPE choice, not a forced one: unlike a tie (whose
 *  removal is genuinely irreversible because finish() overwrites the destination's pitch), a grace beat
 *  is a self-contained beat and could be removed by deleting it — a "Remove grace" control is a clean
 *  follow-up if the owner wants panel-side removal. (Flagged to the owner; logged in implementation_notes.) */
export const GRACE_OPTIONS: { label: string; value: model.GraceType }[] = [
  { label: 'Before beat', value: model.GraceType.BeforeBeat },
  { label: 'On beat', value: model.GraceType.OnBeat },
]

/**
 * Insert a grace note before the selection, copying the selected note's pitch. No-op when the string
 * carries no note (nothing to ornament). Shifts the selection to the (now +1) main beat so the user
 * keeps editing the note they started on — mirrors `insertBeatAfterSelection`.
 */
export function setSelectedGrace(graceType: model.GraceType = model.GraceType.BeforeBeat): void {
  const { selection, selectedString, api } = store.getState()
  if (!selection || !api?.score) return
  const note = resolveNote(api.score, selection, selectedString)
  if (!note) return
  execute(new InsertGraceBeatCommand(selection, selectedString, graceType))
  store.setState({ selection: { ...selection, beatIndex: selection.beatIndex + 1 } })
}
