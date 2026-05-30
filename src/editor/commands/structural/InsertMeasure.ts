import { model } from '@coderline/alphatab'
import type { Command } from '../../CommandStack'
import type { BeatRef } from '../../selection'
import { ScoreMutator } from '../../ScoreMutator'
import { execute } from '../../HistoryRouter'
import { store } from '../../store'

/**
 * Insert an empty measure AFTER bar N (PHASE_5 decision 8). A `MasterBar` is shared across all
 * tracks, so this fans out: one new `MasterBar` plus one new `Bar` in **every staff of every
 * track**, keeping the bars-per-staff == masterbars invariant.
 *
 * Each new `Bar` gets as many voices as its siblings (`staff.bars[0].voices.length` — never
 * hardcode 1; a 2-voice score would otherwise get an under-voiced bar that finish() won't repair
 * mid-array), each voice holding a single quarter-rest `Beat` (`new model.Beat()` defaults to a
 * renderable quarter rest). The new masterbar inherits bar N's time sig (so no spurious change
 * glyph), and each new bar inherits clef/clefOttava/keySignature/keySignatureType from the previous
 * bar — mirroring alphaTab's own fill-bars logic (core.mjs:4358). A `new Bar()` defaults to
 * `KeySignature.C`, so in any non-C key an un-inherited bar would inject a spurious "→ C" glyph.
 *
 * ⚠ After splicing, `relinkStructure()` rebuilds indices + chains (finish() does NOT — see the
 * helper's note); `afterMutation` runs the `relayout:'score'` finish(). Redo re-splices the SAME
 * cached objects (like InsertBeat) so undo's `indexOf` keeps finding them.
 */
export class InsertMeasureCommand implements Command {
  readonly relayout = 'score' as const
  private at: BeatRef
  private master: model.MasterBar | null = null
  private bars: { staff: model.Staff; bar: model.Bar }[] | null = null

  constructor(at: BeatRef) {
    this.at = at
  }

  apply(score: model.Score): void {
    const n = this.at.barIndex
    const ref = score.masterBars[n]
    if (!ref) return

    if (this.master === null) {
      const mb = new model.MasterBar()
      mb.score = score
      mb.timeSignatureNumerator = ref.timeSignatureNumerator
      mb.timeSignatureDenominator = ref.timeSignatureDenominator
      mb.timeSignatureCommon = ref.timeSignatureCommon
      const bars: { staff: model.Staff; bar: model.Bar }[] = []
      for (const track of score.tracks) {
        for (const staff of track.staves) {
          const prev = staff.bars[n]
          const bar = new model.Bar()
          bar.staff = staff
          if (prev) {
            bar.clef = prev.clef
            bar.clefOttava = prev.clefOttava
            bar.keySignature = prev.keySignature
            bar.keySignatureType = prev.keySignatureType
          }
          const voiceCount = staff.bars[0]?.voices.length ?? 1
          for (let v = 0; v < voiceCount; v++) {
            // Use the model's own add methods (like makeMinimalScore / ModelUtils.consolidate): they
            // set voice.bar + voice.index and beat.voice + beat.index. Bar.finish does NOT reindex
            // voices, so voice.index in particular must be set here.
            const voice = new model.Voice()
            bar.addVoice(voice)
            voice.addBeat(new model.Beat())
          }
          bars.push({ staff, bar })
        }
      }
      this.master = mb
      this.bars = bars
    }

    score.masterBars.splice(n + 1, 0, this.master)
    for (const { staff, bar } of this.bars!) staff.bars.splice(n + 1, 0, bar)
    new ScoreMutator(score).relinkStructure()
  }

  undo(score: model.Score): void {
    if (!this.master || !this.bars) return
    const mi = score.masterBars.indexOf(this.master)
    if (mi >= 0) score.masterBars.splice(mi, 1)
    for (const { staff, bar } of this.bars) {
      const bi = staff.bars.indexOf(bar)
      if (bi >= 0) staff.bars.splice(bi, 1)
    }
    new ScoreMutator(score).relinkStructure()
  }

  describe(): string {
    return `Insert measure after bar ${this.at.barIndex}`
  }
}

/**
 * Insert a measure after the selected bar (PHASE_5 decision 8 — "after the selected bar; you can
 * repeat"). The new bar lands at `selection.barIndex + 1`, i.e. AFTER the selected bar, so the
 * selected bar itself never moves — the selection stays valid and on the same music with no shift.
 *
 * (The doc's general "+1 bump to stay on the same music" rule is for an UPSTREAM insert — an insert
 * point at or before the selection. The panel only ever inserts after the current bar, so that
 * branch is unreachable here; `InsertMeasureCommand` itself is selection-agnostic and correct for
 * any insert point should a future caller insert elsewhere.)
 */
export function insertMeasureAfterSelection(): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  execute(new InsertMeasureCommand(selection))
}
