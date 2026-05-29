import { store } from './store'
import { CommandStack, type Command } from './CommandStack'
import { reValidateSelection } from './selection'

/**
 * Module-level singleton. The stack itself is non-serializable (like `api`), so it lives here
 * rather than in the store; `canUndo`/`canRedo` are mirrored into the store after every op so
 * UI can subscribe. The stack reads the live Score off the api on demand.
 */
const stack = new CommandStack(() => store.getState().api?.score ?? null)

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
  stack.clear()
  store.setState({ canUndo: false, canRedo: false })
}
