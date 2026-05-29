import { model } from '@coderline/alphatab'
import type { Command } from '../CommandStack'
import { resolveBeat, type BeatRef } from '../selection'
import { ScoreMutator } from '../ScoreMutator'
import { execute } from '../HistoryRouter'
import { store } from '../store'

/**
 * Ordered, longest → shortest. The `Duration` enum is non-linear (Whole=1, Half=2, Quarter=4,
 * 8th=8, …) so a "step" is an index move in this list, never arithmetic. PLAN's range stops at
 * 32nd; 64th+ exist in the enum but are out of scope, so the ladder clamps here.
 */
export const DURATION_LADDER: model.Duration[] = [
  model.Duration.Whole,
  model.Duration.Half,
  model.Duration.Quarter,
  model.Duration.Eighth,
  model.Duration.Sixteenth,
  model.Duration.ThirtySecond,
]

/** Set a beat's duration + dots. Tick/beam reflow needs a relayout, so `relayout = 'voice'`. */
export class ChangeDurationCommand implements Command {
  readonly relayout = 'voice' as const
  private priorDuration: model.Duration | null = null
  private priorDots: number | null = null
  private at: BeatRef
  private newDuration: model.Duration
  private newDots: number

  constructor(at: BeatRef, newDuration: model.Duration, newDots: number) {
    this.at = at
    this.newDuration = newDuration
    this.newDots = newDots
  }

  apply(score: model.Score): void {
    const beat = resolveBeat(score, this.at)
    if (!beat) return
    if (this.priorDuration === null) {
      this.priorDuration = beat.duration
      this.priorDots = beat.dots
    }
    new ScoreMutator(score).changeDuration(this.at, this.newDuration, this.newDots)
  }

  undo(score: model.Score): void {
    if (this.priorDuration === null || this.priorDots === null) return
    new ScoreMutator(score).changeDuration(this.at, this.priorDuration, this.priorDots)
  }

  describe(): string {
    return `Set duration ${this.newDuration}${this.newDots ? ' dotted' : ''} on beat ${this.at.beatIndex}`
  }
}

/**
 * Step the selected beat's duration. `dir = -1` shortens (whole→half→…→32nd, the `-` key);
 * `dir = +1` lengthens (the `+`/`=` key). Clamps at both ends. Dots are preserved.
 */
export function stepSelectedDuration(dir: -1 | 1): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  const beat = resolveBeat(api.score, selection)
  if (!beat) return
  const i = DURATION_LADDER.indexOf(beat.duration)
  // Shorten = move toward the end of the ladder (index +1); lengthen = toward the start (-1).
  const baseIndex = i === -1 ? DURATION_LADDER.indexOf(model.Duration.Quarter) : i
  const next = baseIndex - dir
  if (next < 0 || next >= DURATION_LADDER.length) return // clamp at whole / 32nd
  if (DURATION_LADDER[next] === beat.duration) return
  execute(new ChangeDurationCommand(selection, DURATION_LADDER[next], beat.dots))
}

/** Toggle the dotted flag (0 ↔ 1) on the selected beat. */
export function toggleSelectedDot(): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  const beat = resolveBeat(api.score, selection)
  if (!beat) return
  execute(new ChangeDurationCommand(selection, beat.duration, beat.dots ? 0 : 1))
}
