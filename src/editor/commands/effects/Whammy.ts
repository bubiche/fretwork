import { model } from '@coderline/alphatab'
import type { Command } from '../../CommandStack'
import { store } from '../../store'
import { ScoreMutator, type CurvePoint } from '../../ScoreMutator'
import { resolveBeat, type BeatRef } from '../../selection'
import { execute } from '../../HistoryRouter'

/**
 * Phase 4b — whammy / tremolo bar. The beat-level twin of {@link SetBendCommand}: a `whammyBarType`
 * enum plus a `whammyBarPoints` curve, both moved together (`hasWhammyBar` reads both). Dives go
 * BELOW pitch, so curve values are negative. Same capture/undo discipline as the bend command —
 * boolean capture-once (`WhammyType.None = 0` is a legal prior), deep-copied prior points so undo is
 * independent of any finish() array mutation, `relayout: 'voice'` for the glyph band.
 */
export class SetWhammyCommand implements Command {
  readonly relayout = 'voice' as const
  private captured = false
  private priorType: model.WhammyType = model.WhammyType.None
  private priorPoints: CurvePoint[] | null = null
  private at: BeatRef
  private whammyType: model.WhammyType
  private points: CurvePoint[] | null
  private label: string

  constructor(
    at: BeatRef,
    whammyType: model.WhammyType,
    points: CurvePoint[] | null,
    label = 'Whammy',
  ) {
    this.at = at
    this.whammyType = whammyType
    this.points = points
    this.label = label
  }

  apply(score: model.Score): void {
    const beat = resolveBeat(score, this.at)
    if (!beat) return
    if (!this.captured) {
      this.priorType = beat.whammyBarType
      this.priorPoints = beat.whammyBarPoints
        ? beat.whammyBarPoints.map((p) => [p.offset, p.value] as CurvePoint)
        : null
      this.captured = true
    }
    new ScoreMutator(score).applyWhammy(this.at, this.whammyType, this.points)
  }

  undo(score: model.Score): void {
    if (!this.captured) return
    new ScoreMutator(score).applyWhammy(this.at, this.priorType, this.priorPoints)
  }

  describe(): string {
    return `${this.label} on beat ${this.at.beatIndex}`
  }
}

/**
 * Bundled whammy presets — the short list PHASE_4 ships. Negative values dive below pitch. Range
 * verified against `sample_whammy_dive_full_bend.gp4`, which imports dives down to value −10, so the
 * −8 in "Dive & return" is comfortably in range.
 */
export type WhammyPreset = {
  id: string
  label: string
  whammyType: model.WhammyType
  points: CurvePoint[]
}

export const WHAMMY_PRESETS: WhammyPreset[] = [
  { id: 'dive', label: 'Dive', whammyType: model.WhammyType.Dive, points: [[0, 0], [60, -4]] },
  { id: 'dip', label: 'Dip', whammyType: model.WhammyType.Dip, points: [[0, 0], [30, -4], [60, 0]] },
  { id: 'diveReturn', label: 'Dive & return', whammyType: model.WhammyType.Dive, points: [[0, 0], [30, -8], [60, 0]] },
]

/** Apply a whammy preset to the selected beat. Beat-level: needs only a selection, no string. */
export function setSelectedWhammy(preset: WhammyPreset): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  const beat = resolveBeat(api.score, selection)
  if (!beat) return
  execute(new SetWhammyCommand(selection, preset.whammyType, preset.points, `Whammy: ${preset.label}`))
}

/** Remove the whammy from the selected beat. No-op (pushes nothing) when there's no whammy. */
export function clearSelectedWhammy(): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  const beat = resolveBeat(api.score, selection)
  if (!beat || !beat.hasWhammyBar) return
  execute(new SetWhammyCommand(selection, model.WhammyType.None, null, 'Clear whammy'))
}
