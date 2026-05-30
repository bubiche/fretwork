import { model } from '@coderline/alphatab'
import type { Command } from '../../CommandStack'
import type { BeatRef } from '../../selection'
import { ScoreMutator } from '../../ScoreMutator'
import { execute } from '../../HistoryRouter'
import { store } from '../../store'

/**
 * Delete the measure at bar N — the `MasterBar` plus the `Bar` at N in **every staff of every
 * track** (the all-tracks invariant). Captures every removed object + the index for by-reference
 * undo re-insertion. `relinkStructure()` rebuilds indices + chains after the splice (finish() does
 * NOT — see the helper); `afterMutation` runs the `relayout:'score'` finish().
 *
 * Spike finding: the score-tempo `Automation` on `masterBars[0]` is injected by
 * `ModelUtils.consolidate()` at import time, NOT by `finish()`. So deleting bar 0 and finishing does
 * NOT inject a spurious automation into the new first bar — by-reference undo is a clean inverse,
 * and no `masterBars[0].tempoAutomations` capture/restore is needed (the doc's concern #4 is moot
 * for the finish() path; verified empirically).
 *
 * Guard against deleting the only remaining measure lives in the dispatcher (push no command). The
 * command itself no-ops on a 1-bar score defensively.
 */
export class DeleteMeasureCommand implements Command {
  readonly relayout = 'score' as const
  private at: BeatRef
  private master: model.MasterBar | null = null
  private bars: { staff: model.Staff; bar: model.Bar }[] | null = null

  constructor(at: BeatRef) {
    this.at = at
  }

  apply(score: model.Score): void {
    const n = this.at.barIndex
    if (score.masterBars.length <= 1) return
    const master = score.masterBars[n]
    if (!master) return

    this.master = master
    score.masterBars.splice(n, 1)
    const bars: { staff: model.Staff; bar: model.Bar }[] = []
    for (const track of score.tracks) {
      for (const staff of track.staves) {
        const bar = staff.bars[n]
        if (bar) {
          staff.bars.splice(n, 1)
          bars.push({ staff, bar })
        }
      }
    }
    this.bars = bars
    new ScoreMutator(score).relinkStructure()
  }

  undo(score: model.Score): void {
    if (!this.master || !this.bars) return
    const n = this.at.barIndex
    score.masterBars.splice(n, 0, this.master)
    for (const { staff, bar } of this.bars) staff.bars.splice(n, 0, bar)
    new ScoreMutator(score).relinkStructure()
  }

  describe(): string {
    return `Delete measure at bar ${this.at.barIndex}`
  }
}

/**
 * Delete the selected measure. Refuses to delete the only remaining measure (a zero-bar score is
 * unrenderable) — no-op, push no command. Selection fix: if `selection.barIndex >= N`, walk it back
 * one bar (clamped at 0); `reValidateSelection` (in `afterMutation`) then clamps the beat within the
 * new bar.
 */
export function deleteSelectedMeasure(): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  if (api.score.masterBars.length <= 1) return
  // The deleted bar IS the selected bar, so the selection must walk back one (clamped at 0) to land
  // on still-existing music. Shift the selection's barIndex BEFORE execute: afterMutation runs
  // reValidateSelection, which reads the live store selection and clamps its beatIndex within the
  // destination bar. If we shifted after execute, reValidateSelection would clamp against the wrong
  // (pre-shift) bar and our setState would then discard the clamp — leaving beatIndex past the end of
  // a shorter destination bar (the doc's "set barIndex, then let reValidateSelection clamp" order).
  store.setState({ selection: { ...selection, barIndex: Math.max(0, selection.barIndex - 1) } })
  execute(new DeleteMeasureCommand(selection))
}
