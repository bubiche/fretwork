import type { FileMeta } from '../editor/store'
import { addFile } from './db'

const SEEDED_KEY = 'fretwork:exampleSeeded'
const EXAMPLE_URL = `${import.meta.env.BASE_URL}chanson-du-montmartre.gp`
const EXAMPLE_NAME = 'Chanson Du Montmartre.gp'

/**
 * Pre-load the bundled example tab for first-time visitors. Seeds only when the library is empty
 * AND this browser has never seeded before (localStorage flag) — so deleting the example sticks
 * across reloads. A browser that already has files is marked seeded without touching the library,
 * so emptying it later doesn't resurrect the example. The flag is only set after a successful seed
 * (or on a non-empty library), so an offline first visit retries on the next load.
 *
 * Once added, the example is an ordinary library file: open/rename/delete/auto-save all behave
 * exactly as for a user-imported tab.
 *
 * Returns the seeded FileMeta (so the caller can auto-open it), or null if nothing was seeded.
 */
export async function seedExampleTab(existing: FileMeta[]): Promise<FileMeta | null> {
  if (existing.length > 0) {
    markSeeded()
    return null
  }
  if (hasSeeded()) return null
  try {
    const res = await fetch(EXAMPLE_URL)
    if (!res.ok) throw new Error(`fetch ${EXAMPLE_URL}: ${res.status}`)
    const bytes = await res.arrayBuffer()
    const meta = await addFile(EXAMPLE_NAME, bytes)
    markSeeded()
    return meta
  } catch (err) {
    // Non-fatal: the app just starts with an empty library and tries again next visit.
    console.warn('[seed] example tab failed to load', err)
    return null
  }
}

function hasSeeded(): boolean {
  try {
    return localStorage.getItem(SEEDED_KEY) === 'true'
  } catch {
    return false // no localStorage (tests) or access denied — treat as not seeded
  }
}

function markSeeded(): void {
  try {
    localStorage.setItem(SEEDED_KEY, 'true')
  } catch {
    // best-effort; worst case an empty library seeds again next visit
  }
}
