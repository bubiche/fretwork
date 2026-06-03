import type { model } from '@coderline/alphatab'
import type { Command } from '../CommandStack'
import { execute } from '../HistoryRouter'
import { store } from '../store'

/**
 * Set the score-header metadata alphaTab renders above the first system (`score.title` /
 * `score.artist`). Plain value fields — no beat reindexing, so `relayout` stays `'none'`;
 * the bare `api.render()` in afterMutation re-lays-out the header. Auto-save picks the change
 * up via the scoreVersion bump, so the new title round-trips through the GP7 export.
 *
 * Prior values are captured once on first apply (SetTempo's pattern) so redo doesn't recapture
 * the values we just wrote.
 */
export class SetScoreInfoCommand implements Command {
  private title: string
  private artist: string
  private prior: { title: string; artist: string } | null = null

  constructor(title: string, artist: string) {
    this.title = title
    this.artist = artist
  }

  apply(score: model.Score): void {
    if (!this.prior) this.prior = { title: score.title, artist: score.artist }
    score.title = this.title
    score.artist = this.artist
  }

  undo(score: model.Score): void {
    if (!this.prior) return
    score.title = this.prior.title
    score.artist = this.prior.artist
  }

  describe(): string {
    return `Score info: "${this.title}"${this.artist ? ` — ${this.artist}` : ''}`
  }
}

/** Set the rendered title/artist. No-op when nothing changed, so an untouched blur in the
 *  score-info bar doesn't push a useless undo entry. */
export function setScoreInfo(title: string, artist: string): void {
  const score = store.getState().api?.score
  if (!score) return
  if (score.title === title && score.artist === artist) return
  execute(new SetScoreInfoCommand(title, artist))
}
