import type { model } from '@coderline/alphatab'
import type { Command } from '../CommandStack'

/**
 * Run several commands as ONE undoable step: `apply` in order, `undo` in reverse. Used by paste-over-
 * range (a `PasteCommand` then a `DeleteRangeCommand`) so a single ⌘Z reverts the whole replace.
 *
 * Correctness rests on two properties of the wrapped commands, which hold for the structural family:
 *   1. They splice by ARRAY POSITION and never read `beat.index`, so running the children's `apply`s
 *      back-to-back with NO `finish()` between them is safe — `HistoryRouter.afterMutation` runs
 *      `finish()` exactly once, after the whole composite, so there is no mid-step reindex to confuse
 *      a later child. This breaks if any wrapped command is made index-aware.
 *   2. `relayout` must be the strongest of the children's (here `'voice'`), so the single post-step
 *      finish covers them all.
 */
export class CompositeCommand implements Command {
  readonly relayout: 'none' | 'voice' | 'score'
  private commands: Command[]
  private label: string

  constructor(commands: Command[], label: string, relayout: 'none' | 'voice' | 'score' = 'voice') {
    this.commands = commands
    this.label = label
    this.relayout = relayout
  }

  apply(score: model.Score): void {
    for (const cmd of this.commands) cmd.apply(score)
  }

  undo(score: model.Score): void {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].undo(score)
  }

  describe(): string {
    return this.label
  }
}
