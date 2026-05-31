import { store } from '../editor/store'
import { updateFileBytes } from './db'
import { exportGp7Bytes } from './export'

/**
 * Phase 6 auto-save: after each edit, persist the current score back to its IndexedDB library entry
 * so a reload survives. Overwrite-in-place (owner choice, consistent with resolved Q6 "persist final
 * score state only") — the file's bytes become GP7 export bytes under the same id/name.
 *
 * Debounced 1s like `scheduleMidiRegen` (HistoryRouter), and for the same reason: a burst of edits
 * (multi-digit fret amend, held dynamics stepper) shouldn't run `Gp7Exporter` on every keystroke.
 * `scoreVersion` is the trigger — it bumps once per model change (execute/undo/redo/amend) and never
 * on a bare file load, so a fire always reflects a real edit.
 *
 * **File-switch race** (the same hazard `scheduleMidiRegen` solves by cancelling): a save scheduled
 * while editing file A would otherwise fire after the user switches to B and export B's score under
 * A's id. We FLUSH instead of cancel — when `currentFileId` changes we synchronously save the pending
 * edit for the OLD id. This is safe because the `currentFileId` store update fires this subscriber
 * BEFORE ScoreView's load effect swaps `api.score`, so `api.score` is still A's score at flush time.
 */
const AUTOSAVE_DEBOUNCE_MS = 1000

let timer: ReturnType<typeof setTimeout> | null = null
/** The file id the pending save is for (captured at schedule time, not fire time). */
let pendingId: string | null = null

/** Export the current score to GP7 and overwrite `id`'s bytes. Fire-and-forget; logs on failure. */
function save(id: string): void {
  const { api } = store.getState()
  const score = api?.score
  const settings = api?.settings
  if (!score || !settings) return
  let bytes: Uint8Array
  try {
    bytes = exportGp7Bytes(score, settings)
  } catch (err) {
    // Export is best-effort here — a failed auto-save must not crash the editor. The user can still
    // recover via manual "Export as…". (Q14: no JSON fallback — JsonConverter isn't in the bundle.)
    console.error('[autosave] GP7 export failed; edit not persisted', err)
    return
  }
  // .slice() detaches a standalone ArrayBuffer for IndexedDB (the export may view a pooled buffer).
  const copy = bytes.slice()
  void updateFileBytes(id, copy.buffer).catch((err) => console.error('[autosave] write failed', err))
}

/** Run the pending save now (if any) and clear the timer. Used on flush/file-switch. */
function flush(): void {
  if (timer === null) return
  clearTimeout(timer)
  timer = null
  if (pendingId !== null) save(pendingId)
  pendingId = null
}

/**
 * Wire auto-save to the store. Call once at app start (like `attachKeyboard`); returns an unsubscribe.
 * Lives at the persistence layer and is wired from `App`, so editor-core never depends on persistence.
 */
export function attachAutosave(): () => void {
  const unsubEdit = store.subscribe(
    (s) => s.scoreVersion,
    () => {
      const id = store.getState().currentFileId
      if (!id) return
      pendingId = id
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const target = pendingId
        pendingId = null
        // Defensive: only save if the editor is still on this file (the flush path handles switches,
        // but guard against any reorder).
        if (target && store.getState().currentFileId === target) save(target)
      }, AUTOSAVE_DEBOUNCE_MS)
    },
  )

  // On file switch, persist the outgoing file's last edit before its score is replaced.
  const unsubSwitch = store.subscribe(
    (s) => s.currentFileId,
    () => flush(),
  )

  return () => {
    unsubEdit()
    unsubSwitch()
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    pendingId = null
  }
}
