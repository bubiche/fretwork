import { model } from '@coderline/alphatab'
import { store } from '../../store'
import { resolveNote } from '../../ScoreMutator'
import { resolveBeat } from '../../selection'
import { execute } from '../../HistoryRouter'
import { SetNoteEffectCommand, SetBeatEffectCommand } from './SetEffect'

/**
 * Articulation dispatchers — the panel↔command boundary for the pure (non-linked)
 * effects. Each reads `selection`/`selectedString` from the store, builds a command, and routes
 * it through `execute()`. Note-level dispatchers no-op when there's no note on the selected
 * string (mirrors `changeSelectedFret`); the panel also disables the control, but the dispatcher
 * stays safe for any caller. Toggling an effect *off* is its own command, so undo is symmetric.
 */

// Palm mute renders a "P.M.‒‒‒¬" bracket whose span is re-derived in finish(); use 'voice' so the
// bracket repaints correctly across notes (verify by eye in the browser).
export function toggleSelectedPalmMute(): void {
  toggleNoteFlag('isPalmMute', 'Palm mute', 'voice')
}

export function toggleSelectedGhost(): void {
  toggleNoteFlag('isGhost', 'Ghost note', 'none')
}

export function toggleSelectedDead(): void {
  toggleNoteFlag('isDead', 'Dead note', 'none')
}

/** None → Slight → Wide → None. A single button cycles; the panel labels it with the current
 *  state. (Decided over a submenu: 3 states, less UI.) */
export const VIBRATO_CYCLE: model.VibratoType[] = [
  model.VibratoType.None,
  model.VibratoType.Slight,
  model.VibratoType.Wide,
]

export function cycleSelectedVibrato(): void {
  const { selection, selectedString, api } = store.getState()
  if (!selection || !api?.score) return
  const note = resolveNote(api.score, selection, selectedString)
  if (!note) return
  const i = VIBRATO_CYCLE.indexOf(note.vibrato)
  const next = VIBRATO_CYCLE[(i + 1) % VIBRATO_CYCLE.length]
  // 'voice': vibrato renders as a wavy line in an OwnedTop effect band (core.mjs:75892) — an effect
  // band that allocates vertical space above the staff, same class as palm mute's bracket. Like palm
  // mute, a bare render() doesn't reliably build the band when it first appears; finish() does. (See
  // the palm-mute note; verify by eye in the browser.)
  execute(new SetNoteEffectCommand(selection, selectedString, 'vibrato', next, { relayout: 'voice', label: 'Vibrato' }))
}

// ── Dynamics (beat-level, per the owner's 4a decision) ────────────────────────────────────────
// The enum is a contiguous, musically-ordered 0–7 ladder (PPP..FFF); step it like DURATION_LADDER.
// Values 8+ (extended dynamics, accents) are out of scope.
export const DYNAMICS_LADDER: model.DynamicValue[] = [
  model.DynamicValue.PPP,
  model.DynamicValue.PP,
  model.DynamicValue.P,
  model.DynamicValue.MP,
  model.DynamicValue.MF,
  model.DynamicValue.F,
  model.DynamicValue.FF,
  model.DynamicValue.FFF,
]

/** Step the selected beat's dynamics. `dir = -1` softer, `+1` louder. Clamps at both ends. */
export function stepSelectedDynamics(dir: -1 | 1): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  const beat = resolveBeat(api.score, selection)
  if (!beat) return
  const i = DYNAMICS_LADDER.indexOf(beat.dynamics)
  const base = i === -1 ? DYNAMICS_LADDER.indexOf(model.DynamicValue.MF) : i
  const next = base + dir
  if (next < 0 || next >= DYNAMICS_LADDER.length) return // clamp
  if (DYNAMICS_LADDER[next] === beat.dynamics) return
  // 'voice': dynamics renders as text in a SharedBottom effect band (core.mjs:75921) below the staff
  // — appearing/disappearing changes the bottom-band space allocation. Same effect-band class as palm
  // mute/vibrato, so finish() (not a bare render()) is what lays the band out reliably. (Browser-verify.)
  execute(new SetBeatEffectCommand(selection, 'dynamics', DYNAMICS_LADDER[next], { relayout: 'voice', label: 'Dynamics' }))
}

function toggleNoteFlag(
  key: 'isPalmMute' | 'isGhost' | 'isDead',
  label: string,
  relayout: 'none' | 'voice',
): void {
  const { selection, selectedString, api } = store.getState()
  if (!selection || !api?.score) return
  const note = resolveNote(api.score, selection, selectedString)
  if (!note) return
  execute(
    new SetNoteEffectCommand(selection, selectedString, key, !note[key], { relayout, label }),
  )
}
