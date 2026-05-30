import { model } from '@coderline/alphatab'
import type { Command } from '../../CommandStack'
import { store } from '../../store'
import { ScoreMutator, resolveNote, type CurvePoint } from '../../ScoreMutator'
import type { BeatRef } from '../../selection'
import { execute } from '../../HistoryRouter'

/**
 * Phase 4b — note bend. A bend is a `bendType` enum plus a `bendPoints` curve; both must move
 * together (the renderer reads both — `hasBend` is `bendPoints !== null && bendType !== None`). So
 * unlike the 4a single-field effects this can't ride `SetNoteEffectCommand`; it gets its own command.
 *
 * Capture/undo notes:
 *  - CAPTURE-ONCE via a boolean `captured` flag, NOT `=== null`: `BendType.None = 0` is a legal prior
 *    and `bendPoints` is legitimately `null` when there's no bend — neither can double as a sentinel.
 *  - Prior points are deep-copied to `[offset, value]` tuples at capture. This is deliberate and
 *    load-bearing: PHASE_4 warned `finish()` may splice/normalize the live array. (Empirically the
 *    installed 1.8.2 leaves these recipes untouched — logged in implementation_notes.md — but the
 *    deep copy makes undo correct regardless of what finish() does to the array, so undo never
 *    depends on finish's array behaviour.)
 *  - `relayout: 'voice'` → `afterMutation` runs `score.finish()`, which lays out the bend glyph band.
 *
 * The same command both SETS (real type + points) and CLEARS (`None` + `null`); the dispatchers pick.
 */
export class SetBendCommand implements Command {
  readonly relayout = 'voice' as const
  private captured = false
  private priorType: model.BendType = model.BendType.None
  private priorPoints: CurvePoint[] | null = null
  private at: BeatRef
  private stringIndex: number
  private bendType: model.BendType
  private points: CurvePoint[] | null
  private label: string

  constructor(
    at: BeatRef,
    stringIndex: number,
    bendType: model.BendType,
    points: CurvePoint[] | null,
    label = 'Bend',
  ) {
    this.at = at
    this.stringIndex = stringIndex
    this.bendType = bendType
    this.points = points
    this.label = label
  }

  apply(score: model.Score): void {
    const note = resolveNote(score, this.at, this.stringIndex)
    if (!note) return
    if (!this.captured) {
      this.priorType = note.bendType
      this.priorPoints = note.bendPoints ? note.bendPoints.map((p) => [p.offset, p.value] as CurvePoint) : null
      this.captured = true
    }
    new ScoreMutator(score).applyBend(this.at, this.stringIndex, this.bendType, this.points)
  }

  undo(score: model.Score): void {
    if (!this.captured) return
    new ScoreMutator(score).applyBend(this.at, this.stringIndex, this.priorType, this.priorPoints)
  }

  describe(): string {
    return `${this.label} on beat ${this.at.beatIndex}`
  }
}

/**
 * The bundled bend presets — the short curve list PHASE_4 ships (the graphical curve editor is a
 * Phase 7 stretch item). Each writes `bendType` AND the standard `bendPoints`. Value scale verified
 * empirically against `test/fixtures/sample_whammy_dive_full_bend.gp4` ("Eruption"): a full-step
 * bend imports as value 4, a half-step as value 2 — i.e. `value / 2 = semitones`. (See PHASE_4
 * "Curve presets" and the fixture-effects test.)
 */
export type BendPreset = {
  id: string
  label: string
  bendType: model.BendType
  points: CurvePoint[]
}

export const BEND_PRESETS: BendPreset[] = [
  { id: 'half', label: '½ step', bendType: model.BendType.Bend, points: [[0, 0], [30, 2], [60, 2]] },
  { id: 'full', label: 'Full step', bendType: model.BendType.Bend, points: [[0, 0], [30, 4], [60, 4]] },
  { id: 'oneHalf', label: '1½ step', bendType: model.BendType.Bend, points: [[0, 0], [30, 6], [60, 6]] },
  { id: 'bendRelease', label: 'Bend & release', bendType: model.BendType.BendRelease, points: [[0, 0], [15, 4], [45, 4], [60, 0]] },
  { id: 'prebend', label: 'Prebend', bendType: model.BendType.Prebend, points: [[0, 4], [60, 4]] },
  { id: 'prebendRelease', label: 'Prebend & release', bendType: model.BendType.PrebendRelease, points: [[0, 4], [60, 0]] },
]

/** Apply a bend preset to the selected note. No-op when the string is empty (mirrors the 4a
 *  note-level dispatchers); the panel also disables the control without a note. */
export function setSelectedBend(preset: BendPreset): void {
  const { selection, selectedString, api } = store.getState()
  if (!selection || !api?.score) return
  const note = resolveNote(api.score, selection, selectedString)
  if (!note) return
  execute(new SetBendCommand(selection, selectedString, preset.bendType, preset.points, `Bend: ${preset.label}`))
}

/** Remove the bend from the selected note. No-op (pushes nothing) when there's no note or no bend —
 *  clearing a clean note would be an undo-able no-op, which the slide/tie dispatchers also avoid. */
export function clearSelectedBend(): void {
  const { selection, selectedString, api } = store.getState()
  if (!selection || !api?.score) return
  const note = resolveNote(api.score, selection, selectedString)
  if (!note || !note.hasBend) return
  execute(new SetBendCommand(selection, selectedString, model.BendType.None, null, 'Clear bend'))
}
