import type { model } from '@coderline/alphatab'
import type { BeatRef } from '../selection'
import { ScoreMutator, resolveNote } from '../ScoreMutator'
import { execute, peekTop, reExecuteTop } from '../HistoryRouter'
import { store } from '../store'
import { AddNoteCommand, type FretAmendable } from './AddNote'

/** Frets are clamped to this inclusive range on entry (PLAN: digits 0–24). */
export const MAX_FRET = 24

/**
 * Set a real fret value on the note at `at`/`stringIndex` — the most basic score-changing edit.
 * Captures the prior fret once so undo restores it exactly (see the capture-once note in `apply`).
 */
export class ChangeFretCommand implements FretAmendable {
  private prior: number | null = null
  private at: BeatRef
  private stringIndex: number
  private newFret: number

  constructor(at: BeatRef, stringIndex: number, newFret: number) {
    this.at = at
    this.stringIndex = stringIndex
    this.newFret = newFret
  }

  /** Current target fret. The multi-digit amend reads this to build the combined value (1 → 12). */
  get currentFret(): number {
    return this.newFret
  }

  /** Mutate the target fret in place. Used by the amend window on the already-pushed command. */
  setFret(fret: number): void {
    this.newFret = fret
  }

  apply(score: model.Score): void {
    const note = resolveNote(score, this.at, this.stringIndex)
    if (!note) return
    // CAPTURE-ONCE. The multi-digit amend re-runs apply() on the top-of-stack after the fret has
    // already changed (1 → 12). An unconditional capture would clobber the original with the
    // partially-typed value and undo would restore the wrong fret. Guard with `=== null`, NOT
    // `if (!this.prior)` — fret 0 is legal and `!0` is true, which would re-clobber.
    if (this.prior === null) this.prior = note.fret
    new ScoreMutator(score).changeFret(this.at, this.stringIndex, this.newFret)
  }

  undo(score: model.Score): void {
    if (this.prior == null) return
    new ScoreMutator(score).changeFret(this.at, this.stringIndex, this.prior)
  }

  describe(): string {
    return `Set fret ${this.newFret} on beat ${this.at.beatIndex}`
  }
}

/**
 * Set the selected string's fret to an exact value — the clickable fret pad in the panel, vs.
 * `changeSelectedFret`'s typed-digit path. Like the keyboard, an empty string routes to AddNote and
 * an occupied one to ChangeFret. A pad click is a complete value, so it ends any open multi-digit
 * amend window (a following pad click or digit starts fresh rather than amending this one).
 */
export function setSelectedFret(fret: number): void {
  const { selection, selectedString, api } = store.getState()
  if (!selection || !api?.score) return
  const clamped = Math.max(0, Math.min(MAX_FRET, Math.round(fret)))
  const note = resolveNote(api.score, selection, selectedString)
  resetFretAmend()
  const cmd = note
    ? new ChangeFretCommand(selection, selectedString, clamped)
    : new AddNoteCommand(selection, selectedString, clamped)
  execute(cmd)
}

// ── Multi-digit amend window ────────────────────────────────────────────────────────────────
// GP behavior: type `1` → fret 1, then `2` within ~500ms → fret 12 (ONE undo entry). The window
// lives here in the dispatcher, never in the pure Command. Module-level mutable state — reset it
// in a `beforeEach` in tests or amend-window cases leak into each other.
const WINDOW_MS = 500
let pending: { cmd: FretAmendable; at: BeatRef; stringIndex: number; t: number } | null = null

/** Reset the amend window. Exposed for tests; also called internally when an amend can't apply. */
export function resetFretAmend(): void {
  pending = null
}

function sameTarget(p: NonNullable<typeof pending>, at: BeatRef, stringIndex: number): boolean {
  return (
    p.stringIndex === stringIndex &&
    p.at.trackIndex === at.trackIndex &&
    p.at.staffIndex === at.staffIndex &&
    p.at.voiceIndex === at.voiceIndex &&
    p.at.barIndex === at.barIndex &&
    p.at.beatIndex === at.beatIndex
  )
}

/**
 * Dispatch a fret digit onto the current selection. Amends the just-pushed `ChangeFretCommand`
 * in place when the same note is still being typed within the window AND that command is still
 * the top of the undo stack — otherwise it pushes a fresh command. The top-of-stack identity
 * check is load-bearing: without it, a `1 → Cmd-Z → 2` sequence would mutate and re-apply a
 * command that's no longer on the stack, corrupting it.
 *
 * Slice A: a digit on an empty string is a no-op. Slice B routes that case to `AddNoteCommand`.
 */
export function changeSelectedFret(digit: number): void {
  const { selection, selectedString, api } = store.getState()
  if (!selection || !api?.score) return
  const note = resolveNote(api.score, selection, selectedString)

  const now = performance.now()
  if (
    pending &&
    sameTarget(pending, selection, selectedString) &&
    now - pending.t < WINDOW_MS &&
    peekTop() === pending.cmd
  ) {
    const combined = Math.min(MAX_FRET, pending.cmd.currentFret * 10 + digit)
    pending.cmd.setFret(combined)
    reExecuteTop()
    pending.t = now
    return
  }

  // Occupied string → change its fret; empty string → add a note (chord build). Both commands are
  // FretAmendable, so a follow-up digit grows either into a two-digit fret through the same window.
  const cmd: FretAmendable = note
    ? new ChangeFretCommand(selection, selectedString, Math.min(MAX_FRET, digit))
    : new AddNoteCommand(selection, selectedString, Math.min(MAX_FRET, digit))
  execute(cmd)
  pending = { cmd, at: selection, stringIndex: selectedString, t: now }
}
