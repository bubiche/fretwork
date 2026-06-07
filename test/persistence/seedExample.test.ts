import '../fixtures/fakeIndexedDb' // installs globalThis.indexedDB — must precede the db.ts import
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Settings, importer } from '@coderline/alphatab'
import { seedExampleTab } from '../../src/persistence/seedExample'
import { getFileBytes, listFiles } from '../../src/persistence/db'
import type { FileMeta } from '../../src/editor/store'

/**
 * First-visit seeding of the bundled example tab, run against the real seedExample.ts + db.ts over
 * the fake IndexedDB. `fetch` is stubbed to serve the actual public/ asset; `localStorage` is a
 * Map-backed stub (node has neither). The fake IndexedDB is module-global, so expected library
 * contents accumulate across tests within this file — assertions are written relative to that.
 */
const examplePath = fileURLToPath(new URL('../../public/chanson-du-montmartre.gp', import.meta.url))
const exampleBytes = readFileSync(examplePath)

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
})

const fetchOk = vi.fn(async () => new Response(new Uint8Array(exampleBytes)))

beforeEach(() => {
  storage.clear()
  fetchOk.mockClear()
  vi.stubGlobal('fetch', fetchOk)
})

const someFile: FileMeta = { id: 'x', name: 'mine.gp', size: 1, addedAt: 1, lastOpenedAt: 1 }

describe('seedExampleTab', () => {
  it('ships an asset that alphaTab can actually parse', () => {
    const score = importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(exampleBytes), new Settings())
    expect(score.title).toBe('Chanson Du Montmartre')
    expect(score.tracks.length).toBeGreaterThan(0)
  })

  it('does not seed when the library already has files, but marks the browser as seeded', async () => {
    expect(await seedExampleTab([someFile])).toBeNull()
    expect(fetchOk).not.toHaveBeenCalled()
    expect(storage.get('fretwork:exampleSeeded')).toBe('true')
    // ...so emptying the library later doesn't resurrect the example.
    expect(await seedExampleTab([])).toBeNull()
  })

  it('seeds an empty unseeded library, stores the bytes, and sets the flag', async () => {
    const before = (await listFiles()).length
    const meta = await seedExampleTab([])
    expect(meta).not.toBeNull()
    expect(meta!.name).toBe('Chanson Du Montmartre.gp')
    expect(storage.get('fretwork:exampleSeeded')).toBe('true')
    expect((await listFiles()).length).toBe(before + 1)
    const bytes = await getFileBytes(meta!.id)
    expect(new Uint8Array(bytes!)).toEqual(new Uint8Array(exampleBytes))
  })

  it('does not seed again once the flag is set (deletion sticks)', async () => {
    storage.set('fretwork:exampleSeeded', 'true')
    expect(await seedExampleTab([])).toBeNull()
    expect(fetchOk).not.toHaveBeenCalled()
  })

  it('is non-fatal on fetch failure and leaves the flag unset so the next visit retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await seedExampleTab([])).toBeNull()
      expect(storage.has('fretwork:exampleSeeded')).toBe(false)
    } finally {
      warn.mockRestore()
    }
    // Retry on the "next visit" succeeds.
    vi.stubGlobal('fetch', fetchOk)
    expect(await seedExampleTab([])).not.toBeNull()
  })
})
