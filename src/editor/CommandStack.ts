import type { model } from '@coderline/alphatab'

/**
 * A single, reversible edit. `apply` and `undo` mutate the live alphaTab Score in place.
 * In Phase 2 the only Command is the no-op `TouchFretCommand`; Phase 3 adds real edits
 * against the same contract.
 */
export interface Command {
  apply(score: model.Score): void
  undo(score: model.Score): void
  describe(): string
}

/** Max entries kept on the undo stack; oldest are dropped on overflow (PLAN.md). */
export const STACK_CAP = 200

/**
 * Undo/redo stack of Commands. Self-contained: it runs `apply`/`undo` itself, pulling the
 * current Score from the injected accessor, so it has no dependency on alphaTab's api or the
 * store and can be unit-tested with a synthesized Score (Slice C). `HistoryRouter` wraps it
 * to bump `scoreVersion`, trigger a re-render, and mirror `canUndo`/`canRedo` into the store.
 */
export class CommandStack {
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private getScore: () => model.Score | null

  constructor(getScore: () => model.Score | null) {
    this.getScore = getScore
  }

  /** Apply `cmd`, push it, and clear the redo buffer. No-op if there's no score. */
  execute(cmd: Command): void {
    const score = this.getScore()
    if (!score) return
    cmd.apply(score)
    this.undoStack.push(cmd)
    if (this.undoStack.length > STACK_CAP) this.undoStack.shift()
    this.redoStack = []
  }

  undo(): void {
    if (this.undoStack.length === 0) return
    const score = this.getScore()
    if (!score) return
    const cmd = this.undoStack.pop()!
    cmd.undo(score)
    this.redoStack.push(cmd)
  }

  redo(): void {
    if (this.redoStack.length === 0) return
    const score = this.getScore()
    if (!score) return
    const cmd = this.redoStack.pop()!
    cmd.apply(score)
    this.undoStack.push(cmd)
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

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
