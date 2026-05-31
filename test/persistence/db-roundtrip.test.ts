import '../fixtures/fakeIndexedDb' // installs globalThis.indexedDB — must precede the db.ts import
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Settings, model, importer } from '@coderline/alphatab'
import { addFile, updateFileBytes, getFileBytes } from '../../src/persistence/db'
import { exportGp7Bytes } from '../../src/persistence/export'

/**
 * Phase 6 — the actual auto-save PERSISTENCE LOOP, executed headlessly against a polyfilled IndexedDB
 * (`fake-indexeddb`): import → edit → GP7 export → `updateFileBytes` (overwrite in place) → reload via
 * `getFileBytes` → re-import. Proves the edit survives the round-trip and the full Phase 4/5 effect set
 * (bends/whammy/harmonics) isn't silently degraded by going through GP7 on every save. The only
 * remaining untested links are the browser `<a download>` and alphaTab's on-load render worker —
 * owner in-app sign-off.
 */
const eruption = fileURLToPath(new URL('../fixtures/sample_whammy_dive_full_bend.gp4', import.meta.url))

function loadBytes(bytes: Uint8Array): model.Score {
  const s = importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings())
  s.finish(new Settings())
  return s
}

function effectCounts(s: model.Score): { bends: number; whammy: number; harm: number } {
  let bends = 0, whammy = 0, harm = 0
  for (const t of s.tracks) for (const st of t.staves) for (const bar of st.bars) for (const v of bar.voices) for (const b of v.beats) {
    if (b.hasWhammyBar) whammy++
    for (const n of b.notes) {
      if (n.hasBend) bends++
      if (n.harmonicType !== model.HarmonicType.None) harm++
    }
  }
  return { bends, whammy, harm }
}

/** Locate the first note in track 0 (many beats are rests). Returns its position + string so it can
 *  be re-found at the same coordinates after a reload. */
type NoteLoc = { bar: number; beat: number; string: number }
function findFirstNote(s: model.Score): { note: model.Note; loc: NoteLoc } {
  const bars = s.tracks[0].staves[0].bars
  for (let bar = 0; bar < bars.length; bar++) {
    const beats = bars[bar].voices[0].beats
    for (let beat = 0; beat < beats.length; beat++) {
      const n = beats[beat].notes[0]
      if (n) return { note: n, loc: { bar, beat, string: n.string } }
    }
  }
  throw new Error('fixture has no notes')
}
function noteAt(s: model.Score, loc: NoteLoc): model.Note {
  return s.tracks[0].staves[0].bars[loc.bar].voices[0].beats[loc.beat].notes.find((n) => n.string === loc.string)!
}

describe('auto-save persistence loop (real db.ts over fake-indexeddb)', () => {
  it('round-trips an edit and preserves the full effect set through overwrite-in-place', async () => {
    const original = new Uint8Array(readFileSync(eruption))
    const before = effectCounts(loadBytes(original))
    expect(before.bends).toBeGreaterThan(0)
    expect(before.whammy).toBeGreaterThan(0)
    expect(before.harm).toBeGreaterThan(0)

    // Import into the library.
    const meta = await addFile('eruption.gp4', original.buffer.slice(0) as ArrayBuffer)

    // Edit the score (mutate a fret to a sentinel), then auto-save = export GP7 + overwrite in place.
    const edited = loadBytes(original)
    const { note, loc } = findFirstNote(edited)
    const SENTINEL = note.fret === 11 ? 9 : 11 // ensure the value actually changes
    note.fret = SENTINEL
    edited.finish(new Settings())
    const gp7 = exportGp7Bytes(edited, new Settings())
    await updateFileBytes(meta.id, gp7.slice().buffer)

    // Reload exactly as the app does on open.
    const reloaded = await getFileBytes(meta.id)
    expect(reloaded).not.toBeNull()
    const back = loadBytes(new Uint8Array(reloaded!))

    expect(noteAt(back, loc).fret).toBe(SENTINEL) // the edit persisted
    expect(effectCounts(back)).toEqual(before) // nothing else dropped
  })

  it('updateFileBytes no-ops on a missing row (deleted between edit and debounced save)', async () => {
    await expect(updateFileBytes('does-not-exist', new Uint8Array([1, 2, 3]).buffer)).resolves.toBeUndefined()
  })
})
