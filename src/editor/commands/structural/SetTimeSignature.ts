import type { model } from '@coderline/alphatab'
import type { Command } from '../../CommandStack'
import type { BeatRef } from '../../selection'
import { execute } from '../../HistoryRouter'
import { store } from '../../store'

type TimeSig = { num: number; denom: number; common: boolean }

const sigOf = (mb: model.MasterBar): TimeSig => ({
  num: mb.timeSignatureNumerator,
  denom: mb.timeSignatureDenominator,
  common: mb.timeSignatureCommon,
})
const sigEq = (a: TimeSig, b: TimeSig): boolean =>
  a.num === b.num && a.denom === b.denom && a.common === b.common
const writeSig = (mb: model.MasterBar, s: TimeSig): void => {
  mb.timeSignatureNumerator = s.num
  mb.timeSignatureDenominator = s.denom
  mb.timeSignatureCommon = s.common
}

/**
 * Change a bar's time signature, propagating forward **until the next pre-existing change**
 * (PHASE_5 decision 3). Time sig lives on `MasterBar` (shared across all tracks), so this is a
 * masterbar write — `trackIndex`/`voiceIndex` are irrelevant; only `barIndex` matters.
 *
 * The renderer draws a time-sig glyph only where a masterbar differs from its predecessor, so
 * "propagate until next change" is the faithful model: capture bar N's OLD sig, then overwrite
 * every consecutive masterbar that still equals it, stopping at the first that differs (the next
 * pre-existing change). Capture the affected index range ONCE (so redo re-applies the identical
 * range); undo restores each captured old value. No beat reflow — over/underfull bars are accepted
 * (PHASE_5 "no auto-rebar" limitation).
 */
export class SetTimeSignatureCommand implements Command {
  readonly relayout = 'score' as const
  private at: BeatRef
  private sig: TimeSig
  private changed: { index: number; old: TimeSig }[] | null = null

  constructor(at: BeatRef, sig: TimeSig) {
    this.at = at
    this.sig = sig
  }

  apply(score: model.Score): void {
    const mbs = score.masterBars
    const n = this.at.barIndex
    if (this.changed === null) {
      const start = mbs[n]
      if (!start) return
      const oldSig = sigOf(start)
      const captured: { index: number; old: TimeSig }[] = []
      for (let i = n; i < mbs.length; i++) {
        const cur = sigOf(mbs[i])
        if (!sigEq(cur, oldSig)) break
        captured.push({ index: i, old: cur })
      }
      this.changed = captured
    }
    for (const c of this.changed) writeSig(mbs[c.index], this.sig)
  }

  undo(score: model.Score): void {
    if (this.changed === null) return
    for (const c of this.changed) {
      const mb = score.masterBars[c.index]
      if (mb) writeSig(mb, c.old)
    }
  }

  describe(): string {
    return `Time signature ${this.sig.num}/${this.sig.denom} at bar ${this.at.barIndex}`
  }
}

/** Set the selected bar's time signature. Explicit numerals → `common = false` (no C glyph). */
export function setSelectedTimeSignature(num: number, denom: number): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  execute(new SetTimeSignatureCommand(selection, { num, denom, common: false }))
}
