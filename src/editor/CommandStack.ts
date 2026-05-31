import type { model } from '@coderline/alphatab'

/**
 * A single, reversible edit. `apply` and `undo` mutate the live alphaTab Score in place.
 * Every editing command (ChangeFret/ChangeString/AddNote/DeleteNote/Duration/Insert/DeleteBeat)
 * implements this contract; undo/redo both route through `apply`/`undo`.
 */
export interface Command {
  apply(score: model.Score): void
  undo(score: model.Score): void
  describe(): string
  /**
   * How aggressively the renderer must rebuild after this edit. Lives on the Command (not as an
   * `execute()` arg) so undo/redo re-layout identically. `'none'` (default) = value/note edits
   * that `api.render()` picks up on its own (ChangeFret/ChangeString/AddNote/DeleteNote/BeatToRest).
   * `'voice'`/`'score'` = structural/tick-changing edits (ChangeDuration/Insert/DeleteBeat) that
   * need `finish()` to reindex/re-chain/regroup beams first. See HistoryRouter.afterMutation.
   */
  relayout?: 'none' | 'voice' | 'score'
}

/** Max entries kept on the undo stack; oldest are dropped on overflow. */
export const STACK_CAP = 200

/**
 * Undo/redo stack of Commands. Self-contained: it runs `apply`/`undo` itself, pulling the
 * current Score from the injected accessor, so it has no dependency on alphaTab's api or the
 * store and can be unit-tested with a synthesized Score. `HistoryRouter` wraps it
 * to bump `scoreVersion`, trigger a re-render, and mirror `canUndo`/`canRedo` into the store.
 */
export class CommandStack {
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private getScore: () => model.Score | null

  constructor(getScore: () => model.Score | null) {
    this.getScore = getScore
  }

  /** Apply `cmd`, push it, and clear the redo buffer. Returns the command run (for the router's
   *  relayout hint), or null if there's no score. */
  execute(cmd: Command): Command | null {
    const score = this.getScore()
    if (!score) return null
    cmd.apply(score)
    this.undoStack.push(cmd)
    if (this.undoStack.length > STACK_CAP) this.undoStack.shift()
    this.redoStack = []
    return cmd
  }

  /** Returns the command undone (for the relayout hint), or null. */
  undo(): Command | null {
    if (this.undoStack.length === 0) return null
    const score = this.getScore()
    if (!score) return null
    const cmd = this.undoStack.pop()!
    cmd.undo(score)
    this.redoStack.push(cmd)
    return cmd
  }

  /** Returns the command redone (for the relayout hint), or null. */
  redo(): Command | null {
    if (this.redoStack.length === 0) return null
    const score = this.getScore()
    if (!score) return null
    const cmd = this.redoStack.pop()!
    cmd.apply(score)
    this.undoStack.push(cmd)
    return cmd
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** Number of undoable commands. Exposed for tests and the dev console log. */
  get depth(): number {
    return this.undoStack.length
  }

  /** The command currently at the top of the undo stack, or null. Used by the multi-digit
   *  fret amend to verify it's still amending the entry it pushed (see `reExecuteTop`). */
  peek(): Command | null {
    return this.undoStack[this.undoStack.length - 1] ?? null
  }

  /**
   * Re-run `apply` on the current top-of-stack without pushing a new entry. The multi-digit
   * fret amend mutates the top command's target value in place (1 → 12) and calls this to make
   * the change visible. NOT a no-op-safe operation on its own: callers MUST first confirm the
   * top is the command they intend to amend (identity check via `peek`), or this silently
   * re-applies the wrong command. Returns false if there's no score or no top command.
   */
  reExecuteTop(): boolean {
    const score = this.getScore()
    if (!score) return false
    const cmd = this.undoStack[this.undoStack.length - 1]
    if (!cmd) return false
    cmd.apply(score)
    return true
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
