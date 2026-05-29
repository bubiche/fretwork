import type { model } from '@coderline/alphatab'
import type { Command } from '../CommandStack'
import { resolveVoice, type BeatRef } from '../selection'
import { ScoreMutator } from '../ScoreMutator'
import { execute } from '../HistoryRouter'
import { store } from '../store'

/**
 * Insert an empty beat (quarter rest) after `at`. `new model.Beat()` defaults to Quarter / dots 0
 * (verified), so the inserted beat is a renderable quarter rest with no extra setup. Needs a
 * relayout (reindex/chain/beam regroup), so `relayout = 'voice'`. Undo splices the inserted beat
 * back out by reference (array position).
 */
export class InsertBeatCommand implements Command {
  readonly relayout = 'voice' as const
  private inserted: model.Beat | null = null
  private at: BeatRef

  constructor(at: BeatRef) {
    this.at = at
  }

  apply(score: model.Score): void {
    this.inserted = new ScoreMutator(score).insertBeatAfter(this.at)
  }

  undo(score: model.Score): void {
    if (!this.inserted) return
    const voice = resolveVoice(score, this.at)
    if (!voice) return
    const i = voice.beats.indexOf(this.inserted)
    if (i >= 0) voice.beats.splice(i, 1)
  }

  describe(): string {
    return `Insert beat after ${this.at.beatIndex}`
  }
}

/** Insert a beat after the selection and move the selection onto the new beat. */
export function insertBeatAfterSelection(): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  execute(new InsertBeatCommand(selection))
  store.setState({ selection: { ...selection, beatIndex: selection.beatIndex + 1 } })
}
