import { model } from '@coderline/alphatab'
import type { Command } from '../../CommandStack'
import { store } from '../../store'
import { resolveBeat, type BeatRef } from '../../selection'
import { execute } from '../../HistoryRouter'

/**
 * Tremolo picking (beat-level). The write is a single field, `beat.tremoloSpeed`
 * (a `Duration`: 8th/16th/32nd), and `finish()` derives the rest: setting `tremoloSpeed` alone makes
 * finish() populate the `tremoloPicking` object (`{marks, style}`) and flip `isTremolo` — verified
 * empirically against the installed 1.8.2 and `sample_harmonic.gp4` (12 tremolo beats, all
 * `tremoloSpeed 16` → `tremoloPicking.marks 2`). So `tremoloSpeed` is the canonical setter; this is
 * the supported path even though the `.d.ts` marks the accessor `@deprecated` in favour of the object.
 *
 * It can't ride the generic {@link SetBeatEffectCommand}: `tremoloSpeed` is **nullable** and `null`
 * is the legal "off" value, which collides with that command's `=== null` capture sentinel. So this
 * uses the captured-BOOLEAN guard (the Bend/Whammy/Tie pattern) — `null` is a value, not "uncaptured".
 *
 * `relayout: 'voice'`: tremolo changes rhythm rendering (the picking marks/beam), and finish() is what
 * derives `tremoloPicking` from `tremoloSpeed` — a bare render() wouldn't. Undo restores the prior
 * speed (often `null`); a following finish() then clears the derived `tremoloPicking`/`isTremolo`.
 */
export class SetTremoloCommand implements Command {
  readonly relayout = 'voice' as const
  private captured = false
  private prior: model.Duration | null = null
  private at: BeatRef
  private speed: model.Duration | null
  private label: string

  constructor(at: BeatRef, speed: model.Duration | null, label = 'Tremolo') {
    this.at = at
    this.speed = speed
    this.label = label
  }

  apply(score: model.Score): void {
    const beat = resolveBeat(score, this.at)
    if (!beat) return
    if (!this.captured) {
      this.prior = beat.tremoloSpeed
      this.captured = true
    }
    beat.tremoloSpeed = this.speed
  }

  undo(score: model.Score): void {
    if (!this.captured) return
    const beat = resolveBeat(score, this.at)
    if (beat) beat.tremoloSpeed = this.prior
  }

  describe(): string {
    return `${this.label} on beat ${this.at.beatIndex}`
  }
}

/** The tremolo speeds the panel offers — picking subdivision, fast→slow visually as marks count up. */
export type TremoloPreset = { id: string; label: string; speed: model.Duration }

export const TREMOLO_PRESETS: TremoloPreset[] = [
  { id: 'eighth', label: '8th', speed: model.Duration.Eighth },
  { id: 'sixteenth', label: '16th', speed: model.Duration.Sixteenth },
  { id: 'thirtySecond', label: '32nd', speed: model.Duration.ThirtySecond },
]

/** Apply a tremolo speed to the selected beat. Beat-level: needs only a selection, no string. */
export function setSelectedTremolo(preset: TremoloPreset): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  const beat = resolveBeat(api.score, selection)
  if (!beat || beat.tremoloSpeed === preset.speed) return
  execute(new SetTremoloCommand(selection, preset.speed, `Tremolo: ${preset.label}`))
}

/** Remove tremolo from the selected beat. No-op (pushes nothing) when there's no tremolo. */
export function clearSelectedTremolo(): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  const beat = resolveBeat(api.score, selection)
  if (!beat || beat.tremoloSpeed === null) return
  execute(new SetTremoloCommand(selection, null, 'Clear tremolo'))
}
