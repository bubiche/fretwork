import { model } from '@coderline/alphatab'
import type { Command } from '../../CommandStack'
import type { BeatRef } from '../../selection'
import { execute } from '../../HistoryRouter'
import { store } from '../../store'

/**
 * Drop a tempo marker at the START of the selected bar (`ratioPosition = 0`). One marker per bar in
 * v1 — replaces the bar's existing `tempoAutomations` array entirely (PHASE_5 decision 7). Mid-bar
 * tempo automation is out of scope.
 *
 * `Automation.buildTempoAutomation(isLinear, ratioPosition, value, reference, isVisible)`: the 4th
 * arg is a NOTE-VALUE reference index (1–5), NOT a bpm. `reference = 2` is the quarter-note
 * reference (multiplier 1.0), so `automation.value === bpm` — this matches alphaTab's own MIDI path
 * (core.mjs:19761). `isVisible` defaults true → the marker glyph renders above the staff.
 *
 * apply REPLACES the array reference (doesn't mutate in place), so capturing the prior reference is
 * enough for a clean undo — no clone needed. Captured once (a boolean, since the field is an array
 * that's never null and `[]` is truthy) so redo doesn't recapture the marker we just wrote.
 */
export class SetTempoCommand implements Command {
  readonly relayout = 'voice' as const
  private at: BeatRef
  private bpm: number
  private prior: model.Automation[] | null = null
  private captured = false

  constructor(at: BeatRef, bpm: number) {
    this.at = at
    this.bpm = bpm
  }

  apply(score: model.Score): void {
    const mb = score.masterBars[this.at.barIndex]
    if (!mb) return
    if (!this.captured) {
      this.prior = mb.tempoAutomations
      this.captured = true
    }
    mb.tempoAutomations = [model.Automation.buildTempoAutomation(false, 0, this.bpm, 2)]
  }

  undo(score: model.Score): void {
    if (!this.captured || this.prior === null) return
    const mb = score.masterBars[this.at.barIndex]
    if (mb) mb.tempoAutomations = this.prior
  }

  describe(): string {
    return `Tempo ${this.bpm} bpm at bar ${this.at.barIndex}`
  }
}

/** Set (replace) the tempo marker at the start of the selected bar. */
export function setSelectedTempo(bpm: number): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score || !Number.isFinite(bpm) || bpm <= 0) return
  execute(new SetTempoCommand(selection, bpm))
}
