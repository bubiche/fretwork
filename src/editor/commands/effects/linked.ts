import { model } from '@coderline/alphatab'
import type { Command } from '../../CommandStack'
import { store } from '../../store'
import { resolveNote } from '../../ScoreMutator'
import type { BeatRef } from '../../selection'
import { execute } from '../../HistoryRouter'
import { SetNoteEffectCommand } from './SetEffect'

/**
 * Linked-effect dispatchers — let-ring, HO/PO, slide, tie. Key finding: most of
 * these are NOT two-ended commands. Each is a single-field write on one note; `Note.finish()`
 * derives the destination/origin pointers and **clears the flag itself** when there's no valid
 * neighbour. So let-ring / HO/PO / slide reuse the generic {@link SetNoteEffectCommand} with
 * `relayout: 'voice'` (which makes `afterMutation` run `score.finish()` to do the wiring).
 *
 * `finish()` is **set-only** for derived pointers: it wires e.g. `hammerPullDestination` only while
 * the flag is true and never nulls it when the flag goes false (core.mjs:6389). The stale pointer
 * is harmless — the renderer also guards on the flag (:6415) and the snapshot ignores derived
 * pointers — so undo of these three is clean without any teardown.
 *
 * **Tie is the exception** and gets its own {@link TieCommand} — see its doc comment.
 */

export function toggleSelectedLetRing(): void {
  toggleLinkedFlag('isLetRing', 'Let ring')
}

export function toggleSelectedHammerPull(): void {
  toggleLinkedFlag('isHammerPullOrigin', 'Hammer-on / pull-off')
}

/** Set the selected note's slide-out type (None clears it). Submenu-driven from the panel. */
export function setSelectedSlideOut(value: model.SlideOutType): void {
  setSlide('slideOutType', value)
}

/** Set the selected note's slide-in type (None clears it). Submenu-driven from the panel. */
export function setSelectedSlideIn(value: model.SlideInType): void {
  setSlide('slideInType', value)
}

/**
 * Tie the selected note to its predecessor on the same string. Unlike the other linked effects,
 * tie is **not** a clean single-field write: `finish()` copies the origin's `fret`/`octave`/`tone`
 * onto the destination (core.mjs:6726–6730), and — because it wires `this.tieOrigin` and only
 * early-returns when `tieOrigin === null` (:6717) — every *subsequent* finish() re-clobbers `fret`
 * via the stale origin even after `isTieDestination` goes false. So a correct undo must restore
 * `fret`/`octave`/`tone` AND null `tieOrigin` (+ the origin's `tieDestination`) so the next finish()
 * takes the early-return path and the restore survives.
 *
 * **4a scope: tie is apply-only.** Once finish() copies the origin's fret, the destination's
 * original pitch is gone — a *forward* untie can't recover it (it lives only on this command
 * instance). So the panel disables the control when the note is already a tie destination; removal
 * is via undo, which restores everything.
 */
export class TieCommand implements Command {
  readonly relayout = 'voice' as const
  private captured = false
  private priorTie = false
  private priorFret = 0
  private priorOctave = 0
  private priorTone = 0
  private at: BeatRef
  private stringIndex: number

  constructor(at: BeatRef, stringIndex: number) {
    this.at = at
    this.stringIndex = stringIndex
  }

  apply(score: model.Score): void {
    const note = resolveNote(score, this.at, this.stringIndex)
    if (!note) return
    // Capture-once with a boolean flag (not `=== null`): fret 0 is a legal open string, so the
    // captured value can't double as the "uncaptured" sentinel. Redo re-applies without recapturing
    // (otherwise it would snapshot the finish-mutated fret instead of the original).
    if (!this.captured) {
      this.priorTie = note.isTieDestination
      this.priorFret = note.fret
      this.priorOctave = note.octave
      this.priorTone = note.tone
      this.captured = true
    }
    note.isTieDestination = true
    // afterMutation runs score.finish() (relayout:'voice') → wires tieOrigin + copies fret/oct/tone.
  }

  undo(score: model.Score): void {
    if (!this.captured) return
    const note = resolveNote(score, this.at, this.stringIndex)
    if (!note) return
    const origin = note.tieOrigin // wired by the prior finish() (null on the finish-free test path)
    note.isTieDestination = this.priorTie
    note.tieOrigin = null // CRUCIAL: stops the next finish() re-clobbering fret via the stale origin
    note.fret = this.priorFret
    note.octave = this.priorOctave
    note.tone = this.priorTone
    if (origin) origin.tieDestination = null // tear down the glyph wiring; redo re-establishes it
  }

  describe(): string {
    return `Tie note on beat ${this.at.beatIndex}`
  }
}

/** Apply a tie to the selected note (apply-only — see {@link TieCommand}). No-op when the string
 *  is empty or the note is already a tie destination (remove via undo). */
export function tieSelectedNote(): void {
  const { selection, selectedString, api } = store.getState()
  if (!selection || !api?.score) return
  const note = resolveNote(api.score, selection, selectedString)
  if (!note || note.isTieDestination) return
  execute(new TieCommand(selection, selectedString))
}

function toggleLinkedFlag(key: 'isLetRing' | 'isHammerPullOrigin', label: string): void {
  const { selection, selectedString, api } = store.getState()
  if (!selection || !api?.score) return
  const note = resolveNote(api.score, selection, selectedString)
  if (!note) return
  execute(
    new SetNoteEffectCommand(selection, selectedString, key, !note[key], {
      relayout: 'voice',
      label,
    }),
  )
}

function setSlide(
  key: 'slideOutType' | 'slideInType',
  value: model.SlideOutType | model.SlideInType,
): void {
  const { selection, selectedString, api } = store.getState()
  if (!selection || !api?.score) return
  const note = resolveNote(api.score, selection, selectedString)
  if (!note) return
  if (note[key] === value) return // no-op: picking the already-set type
  execute(
    new SetNoteEffectCommand(selection, selectedString, key, value, {
      relayout: 'voice',
      label: 'Slide',
    }),
  )
}
