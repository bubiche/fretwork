import type { model } from '@coderline/alphatab'
import type { Command } from '../CommandStack'
import { resolveVoice, type BeatRef } from '../selection'
import { ScoreMutator } from '../ScoreMutator'
import { execute } from '../HistoryRouter'
import { store } from '../store'
import { beatToRest } from './DeleteNote'

/**
 * Remove the beat at `at` entirely. `apply` captures the removed beat object (preserving all its
 * notes/effects for free) and its array index; `undo` re-inserts the same object at that index.
 * Array-position splice handles index 0 with no special case (the doc's `insertBeat` index-0 hole
 * doesn't apply here). Needs a relayout to reindex/re-chain the survivors, so `relayout = 'voice'`.
 *
 * The "never leave a voice with zero beats" rule (delete the only beat → collapse to a rest) lives
 * in the dispatcher, which routes to BeatToRest instead — so this command always genuinely deletes.
 */
export class DeleteBeatCommand implements Command {
  readonly relayout = 'voice' as const
  private removed: model.Beat | null = null
  private index: number
  private at: BeatRef

  constructor(at: BeatRef) {
    this.at = at
    this.index = at.beatIndex
  }

  apply(score: model.Score): void {
    this.index = this.at.beatIndex
    this.removed = new ScoreMutator(score).removeBeat(this.at)
  }

  undo(score: model.Score): void {
    if (!this.removed) return
    new ScoreMutator(score).reinsertBeat(this.at, this.index, this.removed)
  }

  describe(): string {
    return `Delete beat ${this.at.beatIndex}`
  }
}

/**
 * Delete the selected beat. If it's the only beat in the voice, collapse it to a rest instead of
 * deleting (a zero-beat voice is unrenderable). The selection re-validates in afterMutation, which
 * clamps `beatIndex` to a valid neighbor when the deleted beat was last.
 */
export function deleteSelectedBeat(): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  const voice = resolveVoice(api.score, selection)
  if (!voice) return
  if (voice.beats.length <= 1) {
    beatToRest()
    return
  }
  execute(new DeleteBeatCommand(selection))
}
