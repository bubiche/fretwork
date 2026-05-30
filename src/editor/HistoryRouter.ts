import { store } from './store'
import { CommandStack, type Command } from './CommandStack'
import { reValidateSelection } from './selection'

/**
 * Module-level singleton. The stack itself is non-serializable (like `api`), so it lives here
 * rather than in the store; `canUndo`/`canRedo` are mirrored into the store after every op so
 * UI can subscribe. The stack reads the live Score off the api on demand.
 */
const stack = new CommandStack(() => store.getState().api?.score ?? null)

// Editing the in-memory Score doesn't touch the synth MIDI — alphaTab generates that once at load
// (`api.load`), so playback would keep playing the pre-edit song. Regenerate it after edits settle.
const MIDI_REGEN_DEBOUNCE_MS = 400
let midiRegenTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Schedule a debounced `loadMidiForScore()` so playback reflects the current model. Debounced
 * because the call (a) STOPS playback and (b) re-gens the whole score's MIDI — a burst like the
 * multi-digit fret amend or a held dynamics stepper would otherwise thrash it and stop the player on
 * every keystroke. The api is read fresh at fire time (it changes on file switch), and the call is
 * skipped when the player method is absent — the editor model tests drive a settings-less fake api
 * (`{ score, render() }`) with no `loadMidiForScore`, and we must not throw in a dangling timer.
 */
function scheduleMidiRegen(): void {
  if (midiRegenTimer) clearTimeout(midiRegenTimer)
  midiRegenTimer = setTimeout(() => {
    midiRegenTimer = null
    const api = store.getState().api
    if (api && typeof api.loadMidiForScore === 'function') api.loadMidiForScore()
  }, MIDI_REGEN_DEBOUNCE_MS)
}

/**
 * Re-render and publish state after a stack operation. `scoreVersion` is monotonic — it bumps
 * on every model-changing op so UI that depends on model data (not pixels) can react. The
 * overlay does NOT listen to this; it repositions on `renderFinished` (pixels). Keep orthogonal.
 */
function afterMutation(op: string, cmd?: Command | null): void {
  const state = store.getState()
  const api = state.api
  const relayout = cmd?.relayout ?? 'none'

  // Structural / tick-changing edits need finish() to reindex beats, re-chain, and regroup beams
  // before the renderer runs — bare render() only picks up value changes (Phase 2's finding). The
  // spike proved finish() is idempotent, so calling it after every such edit (incl. undo/redo) is
  // safe. 'voice' and 'score' both run score.finish() for now; the voice-level narrowing is the
  // deferred perf optimization (Risk 7 — profile first). Guard on settings: the editor model tests
  // drive the stack with a settings-less fake api, where relayout stays 'none'.
  if (relayout !== 'none' && api?.score && api.settings) {
    api.score.finish(api.settings)
  }

  // Re-validate the selection against the (possibly restructured) score, on EVERY op including
  // undo/redo — a structural edit or its reversal can shift the beat the selection points at.
  if (api?.score) reValidateSelection(api.score)

  api?.render()
  // Visual is now current; bring playback audio along (debounced — see scheduleMidiRegen). Runs for
  // execute/undo/redo/amend alike, since every model change can alter what's heard.
  scheduleMidiRegen()
  store.setState({
    scoreVersion: state.scoreVersion + 1,
    canUndo: stack.canUndo,
    canRedo: stack.canRedo,
  })
  if (import.meta.env.DEV) {
    // Touch writes the same fret back (no visual change), so this is the primary signal that
    // the pipeline ran during manual verification. `console.info` (not `debug`) so it shows at
    // Chrome's default console level.
    console.info(
      `[history] ${op} depth=${stack.depth} version=${state.scoreVersion + 1} ` +
        `canUndo=${stack.canUndo} canRedo=${stack.canRedo}`,
    )
  }
}

export function execute(cmd: Command): void {
  const ran = stack.execute(cmd)
  afterMutation('execute', ran)
}

/** Top of the undo stack (or null). The multi-digit fret amend checks this to confirm the
 *  command it wants to amend is still the most recent one before re-applying in place. */
export function peekTop(): Command | null {
  return stack.peek()
}

/**
 * Re-apply the top-of-stack command in place and re-render, WITHOUT pushing a new undo entry.
 * Used by the multi-digit fret amend after it has mutated the top command's value. The caller
 * is responsible for having verified (via `peekTop`) that the top is the command it means to
 * amend. `scoreVersion`/`canUndo`/`canRedo` are refreshed; depth is unchanged.
 */
export function reExecuteTop(): void {
  if (!stack.reExecuteTop()) return
  afterMutation('amend')
}

export function undo(): void {
  if (!stack.canUndo) return
  const ran = stack.undo()
  afterMutation('undo', ran)
}

export function redo(): void {
  if (!stack.canRedo) return
  const ran = stack.redo()
  afterMutation('redo', ran)
}

/**
 * Clear the stack on file switch. Indices into the old Score are meaningless against the new
 * one. `scoreVersion` is intentionally left monotonic (not reset to 0).
 */
export function clearHistory(): void {
  // Cancel any pending MIDI regen for the outgoing score — the new file's load() generates its own.
  if (midiRegenTimer) {
    clearTimeout(midiRegenTimer)
    midiRegenTimer = null
  }
  stack.clear()
  store.setState({ canUndo: false, canRedo: false })
}
