import { model } from '@coderline/alphatab'
import { store } from '../../store'
import { resolveNote } from '../../ScoreMutator'
import { resolveBeat } from '../../selection'
import { execute } from '../../HistoryRouter'
import { SetNoteEffectCommand, SetBeatEffectCommand } from './SetEffect'

/**
 * Phase 4b-2 "Advanced" dispatchers that reuse the generic single-field commands — tapping and
 * harmonics. (Tremolo and grace are nullable / structural, so they own their commands.)
 *
 * - **Tapping** is beat-level (`beat.tap`, the common case — note-level `isLeftHandTapped` is
 *   deferred, it isn't even in the snapshot). A plain bool toggle.
 * - **Harmonics** is note-level. Scope is **Natural + Pinch** only: both are empirically verified to
 *   carry `harmonicValue 0` (pitch comes from the fret), so a single `harmonicType` write is enough —
 *   no `harmonicValue` to set. Artificial is deferred (no fixture calibrates its offset scale).
 *   (Edge case on imported files: switching a note that already has `harmonicValue ≠ 0` — e.g. an
 *   imported Artificial harmonic — to Natural leaves the stale offset, since we don't write the value.
 *   Unreachable for editor-created notes (always value 0); documented in implementation_notes.md.)
 *
 * **Both use `relayout: 'voice'`, NOT the table's `'none'`.** Tap ("T") and Pinch ("P.H.") render as
 * text in an above-staff effect band — the same OwnedTop band class that forced palm mute / vibrato /
 * dynamics from `'none'` to `'voice'` in 4a (a bare render() doesn't reliably build the band when it
 * first appears; finish() does). The 4b-2 table said `'none'` for the same reason the 4a table did, and
 * it was wrong there too. Per the relayout rule "when unsure, prefer 'voice'" — finish() is idempotent;
 * the only cost is deferred perf. (Natural harmonics are a plain diamond-notehead glyph and wouldn't
 * strictly need it, but the command is one path and Pinch does — so 'voice' covers both.)
 */

/** Toggle beat-level tap on the selected beat. Beat-level: needs only a selection, no string. */
export function toggleSelectedTap(): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  const beat = resolveBeat(api.score, selection)
  if (!beat) return
  execute(new SetBeatEffectCommand(selection, 'tap', !beat.tap, { relayout: 'voice', label: 'Tap' }))
}

/** The harmonic types the panel offers. Natural/Pinch verified `harmonicValue 0`; `None` clears. */
export const HARMONIC_OPTIONS: { label: string; value: model.HarmonicType }[] = [
  { label: 'None', value: model.HarmonicType.None },
  { label: 'Natural', value: model.HarmonicType.Natural },
  { label: 'Pinch', value: model.HarmonicType.Pinch },
]

/**
 * Set the selected note's harmonic type (None clears it). Submenu-driven from the panel. No-op when
 * the string is empty or the type is already set (no undo-able no-op, mirrors the slide dispatcher).
 */
export function setSelectedHarmonic(value: model.HarmonicType): void {
  const { selection, selectedString, api } = store.getState()
  if (!selection || !api?.score) return
  const note = resolveNote(api.score, selection, selectedString)
  if (!note || note.harmonicType === value) return
  execute(
    new SetNoteEffectCommand(selection, selectedString, 'harmonicType', value, {
      relayout: 'voice',
      label: 'Harmonic',
    }),
  )
}
