import { describe, it, expect } from 'vitest'
import { CHORD_LIBRARY, CHORD_TUNING_LENGTH } from '../../src/editor/commands'

// The bundled chord library is ~60 HAND-AUTHORED entries — the one place a typo'd
// 5- or 7-element `strings` array, a bad fret, or a duplicate name slips through silently (the
// round-trip test proves the data round-trips, not that it's well-formed). This locks the invariants
// the SetChordCommand + tuning-guard rely on. `fixture-chords.test.ts` locks the IMPORT shape; this
// locks OUR data.

describe('chords.json: bundled library invariants', () => {
  it('is a non-trivial curated set (~60 entries)', () => {
    expect(CHORD_LIBRARY.length).toBeGreaterThanOrEqual(40)
  })

  it('every entry is well-formed for a 6-string track', () => {
    for (const c of CHORD_LIBRARY) {
      expect(c.name.length, `name on ${JSON.stringify(c)}`).toBeGreaterThan(0)
      // strings is high-e → low-E; length MUST equal the track string count or the renderer reads
      // past the tuning array (the chord caveat the tuning-guard exists to prevent).
      expect(c.strings.length, `${c.name} strings length`).toBe(CHORD_TUNING_LENGTH)
      for (const fret of c.strings) {
        expect(Number.isInteger(fret), `${c.name} fret ${fret}`).toBe(true)
        expect(fret, `${c.name} fret ${fret}`).toBeGreaterThanOrEqual(-1) // -1 = muted
        expect(fret, `${c.name} fret ${fret}`).toBeLessThanOrEqual(24)
      }
      expect(c.strings.some((f) => f >= 0), `${c.name} has at least one played string`).toBe(true)
      if (c.firstFret !== undefined) expect(c.firstFret, `${c.name} firstFret`).toBeGreaterThanOrEqual(1)
      if (c.barreFrets !== undefined)
        for (const bf of c.barreFrets) expect(bf, `${c.name} barreFret`).toBeGreaterThanOrEqual(1)
    }
  })

  it('names are unique (each doubles as the chordId — a dup is a silent map collision)', () => {
    const names = CHORD_LIBRARY.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('covers the families the picker groups by (open, barre, 7ths)', () => {
    const names = new Set(CHORD_LIBRARY.map((c) => c.name))
    for (const open of ['C', 'G', 'D', 'A', 'E', 'Am', 'Em', 'Dm', 'F']) expect(names.has(open)).toBe(true)
    expect(CHORD_LIBRARY.some((c) => (c.barreFrets?.length ?? 0) > 0)).toBe(true) // a barre shape
    expect([...names].some((n) => n.endsWith('7'))).toBe(true) // a 7th
  })
})
