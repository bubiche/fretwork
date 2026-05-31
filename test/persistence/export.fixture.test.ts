import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Settings, model, importer } from '@coderline/alphatab'
import { exportGp7Bytes, exportAlphaTex } from '../../src/persistence/export'
import { SetKeySignatureCommand } from '../../src/editor/commands/structural/SetKeySignature'
import type { BeatRef } from '../../src/editor/selection'
import { makeMinimalScore } from '../fixtures/makeMinimalScore'

/**
 * Phase 6 Q13 — export round-trip fidelity. Two exporters off the public bundle:
 *   - `Gp7Exporter` (`.gp`): the battle-tested path (also copy/paste + auto-save). Asserted lossless
 *     for bends, stable for whammy (one benign duplicate point — see clipboard-fidelity test), and
 *     preserving harmonics. The ONE known lossy case is verified explicitly below: a key signature on
 *     a NON-track-0 staff is dropped, because GP stores key sig once per bar at MasterBar level (which
 *     proxies track 0). Track-0 key sig survives.
 *   - `AlphaTexExporter` (`.alphatab`): the human-readable companion. We assert effect COUNTS survive
 *     a round-trip and that a second cycle is idempotent (no compounding loss) — it's the less-
 *     exercised path, so this is the bound we claim, not field-level fidelity.
 *
 * (Q14: no JSON fallback test — `JsonConverter` is absent from `alphaTab.mjs`, the app's runtime
 * entry; it lives only in `alphaTab.core.mjs`. Documented gap, not a code path.)
 */
const eruption = fileURLToPath(new URL('../fixtures/sample_whammy_dive_full_bend.gp4', import.meta.url))

function loadBytes(bytes: Uint8Array): model.Score {
  const s = importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings())
  s.finish(new Settings())
  return s
}
function loadText(text: string): model.Score {
  return loadBytes(new TextEncoder().encode(text))
}

type Pt = [number, number]
const points = (ps: model.BendPoint[] | null): Pt[] | null => (ps ? ps.map((p) => [p.offset, p.value]) : null)
function dedupe(ps: Pt[] | null): Pt[] | null {
  if (!ps) return ps
  return ps.filter((p, i) => i === 0 || p[0] !== ps[i - 1][0] || p[1] !== ps[i - 1][1])
}

type Stats = { tracks: number; masterBars: number; beats: number; notes: number; bends: number; whammy: number; harm: number }
function stats(s: model.Score): Stats {
  let beats = 0, notes = 0, bends = 0, whammy = 0, harm = 0
  for (const t of s.tracks) for (const st of t.staves) for (const bar of st.bars) for (const v of bar.voices) for (const b of v.beats) {
    beats++
    if (b.hasWhammyBar) whammy++
    for (const n of b.notes) {
      notes++
      if (n.hasBend) bends++
      if (n.harmonicType !== model.HarmonicType.None) harm++
    }
  }
  return { tracks: s.tracks.length, masterBars: s.masterBars.length, beats, notes, bends, whammy, harm }
}

function flatBeats(score: model.Score): model.Beat[] {
  const out: model.Beat[] = []
  for (const bar of score.tracks[0].staves[0].bars) for (const b of bar.voices[0].beats) out.push(b)
  return out
}

describe('GP7 export fidelity (Gp7Exporter → re-import)', () => {
  it('preserves frets, harmonics, bend points (raw) and whammy points (normalized)', () => {
    const original = loadBytes(new Uint8Array(readFileSync(eruption)))
    const round = loadBytes(exportGp7Bytes(original, new Settings()))

    const src = flatBeats(original)
    const dst = flatBeats(round)
    expect(dst.length).toBe(src.length)

    let bendsChecked = 0
    let whammiesChecked = 0
    for (let i = 0; i < src.length; i++) {
      expect(dst[i].whammyBarType).toBe(src[i].whammyBarType)
      expect(dedupe(points(dst[i].whammyBarPoints))).toEqual(dedupe(points(src[i].whammyBarPoints)))
      if (src[i].hasWhammyBar) whammiesChecked++

      const sn = [...src[i].notes].sort((a, b) => a.string - b.string)
      const dn = [...dst[i].notes].sort((a, b) => a.string - b.string)
      expect(dn.map((n) => [n.string, n.fret])).toEqual(sn.map((n) => [n.string, n.fret]))
      expect(dn.map((n) => [n.harmonicType, n.harmonicValue])).toEqual(sn.map((n) => [n.harmonicType, n.harmonicValue]))
      for (let k = 0; k < sn.length; k++) {
        expect(dn[k].bendType).toBe(sn[k].bendType)
        expect(points(dn[k].bendPoints)).toEqual(points(sn[k].bendPoints)) // RAW — bends are lossless
        if (sn[k].hasBend) bendsChecked++
      }
    }
    expect(bendsChecked).toBeGreaterThan(0)
    expect(whammiesChecked).toBeGreaterThan(0)
  })

  it('is idempotent across two round-trips (no compounding loss)', () => {
    const original = loadBytes(new Uint8Array(readFileSync(eruption)))
    const rt1 = loadBytes(exportGp7Bytes(original, new Settings()))
    const rt2 = loadBytes(exportGp7Bytes(rt1, new Settings()))
    expect(stats(rt2)).toEqual(stats(rt1))
  })
})

describe('GP7 key-signature fidelity (Q13 lossy-conversion finding)', () => {
  const at = (barIndex: number, trackIndex = 0): BeatRef => ({ trackIndex, staffIndex: 0, voiceIndex: 0, barIndex, beatIndex: 0 })

  it('preserves a key signature set on track 0 (the supported path)', () => {
    const score = makeMinimalScore({ bars: 2, beatsPerBar: 1, strings: 6 })
    new SetKeySignatureCommand(at(0), model.KeySignature.D, model.KeySignatureType.Major).apply(score)
    score.finish(new Settings())

    const round = loadBytes(exportGp7Bytes(score, new Settings()))
    expect(round.tracks[0].staves[0].bars[0].keySignature).toBe(model.KeySignature.D)
  })

  it('DROPS a key signature set on a non-track-0 staff (GP stores key sig at MasterBar = track 0)', () => {
    // Two tracks; change key sig on track 1 only (what SetKeySignatureCommand does for a selected
    // non-zero track). GP7 has no per-track key sig, so the change cannot survive export. This test
    // PINS the known limitation so a future "fix" (mirror to MasterBar) trips it deliberately.
    const score = new model.Score()
    for (let t = 0; t < 2; t++) {
      const track = new model.Track()
      score.addTrack(track)
      const staff = new model.Staff()
      track.addStaff(staff)
      staff.stringTuning = new model.Tuning('t', [64, 59, 55, 50, 45, 40], false)
    }
    for (let b = 0; b < 2; b++) {
      score.addMasterBar(new model.MasterBar())
      for (let t = 0; t < 2; t++) {
        const bar = new model.Bar()
        score.tracks[t].staves[0].addBar(bar)
        const v = new model.Voice()
        bar.addVoice(v)
        const beat = new model.Beat()
        beat.duration = model.Duration.Quarter
        v.addBeat(beat)
        const n = new model.Note()
        n.string = 1
        n.fret = 0
        beat.addNote(n)
      }
    }
    new SetKeySignatureCommand(at(0, 1), model.KeySignature.A, model.KeySignatureType.Major).apply(score)
    expect(score.tracks[1].staves[0].bars[0].keySignature).toBe(model.KeySignature.A) // set in-model
    score.finish(new Settings())

    const round = loadBytes(exportGp7Bytes(score, new Settings()))
    // Dropped on export — reverts to the MasterBar/track-0 value (C / 0). Documented Q13 limitation.
    expect(round.tracks[1].staves[0].bars[0].keySignature).toBe(model.KeySignature.C)
  })
})

describe('alphaTex export fidelity (AlphaTexExporter → re-import)', () => {
  it('preserves effect counts and is idempotent across two round-trips', () => {
    const original = loadBytes(new Uint8Array(readFileSync(eruption)))
    const base = stats(original)
    expect(base.bends).toBeGreaterThan(0)
    expect(base.whammy).toBeGreaterThan(0)
    expect(base.harm).toBeGreaterThan(0)

    const rt1 = loadText(exportAlphaTex(original, new Settings()))
    const rt2 = loadText(exportAlphaTex(rt1, new Settings()))

    // Counts survive the first round-trip…
    expect(stats(rt1)).toEqual(base)
    // …and a second cycle changes nothing (no compounding loss — safe for repeated save→reload).
    expect(stats(rt2)).toEqual(stats(rt1))
  })
})
