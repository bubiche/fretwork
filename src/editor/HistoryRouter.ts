import { store } from './store'
import { CommandStack, type Command } from './CommandStack'

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
function afterMutation(op: string): void {
  const state = store.getState()
  state.api?.render()
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
  stack.execute(cmd)
  afterMutation('execute')
}

export function undo(): void {
  if (!stack.canUndo) return
  stack.undo()
  afterMutation('undo')
}

export function redo(): void {
  if (!stack.canRedo) return
  stack.redo()
  afterMutation('redo')
}

/**
 * Clear the stack on file switch. Indices into the old Score are meaningless against the new
 * one. `scoreVersion` is intentionally left monotonic (not reset to 0).
 */
export function clearHistory(): void {
  stack.clear()
  store.setState({ canUndo: false, canRedo: false })
}
