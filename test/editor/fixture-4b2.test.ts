import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Settings, model, importer } from '@coderline/alphatab'

// 4b-2: the "verify against a real imported file" instructions for tremolo, grace, and the
// pinch-harmonic value scale resolve against real GP4 exports. This file LOCKS the three findings the
// 4b-2 commands are built on, so they're standing tests rather than one-off console checks:
//   1. tremolo  → `beat.tremoloSpeed` is the populated field (sample_harmonic, 16 = Sixteenth)
//   2. grace    → a grace note is a SEPARATE beat (graceType set, displayDuration 0), NOT a flag on
//                 the main beat — this is the fact that drove the composite InsertGraceBeatCommand
//   3. harmonic → Pinch harmonics carry harmonicValue 0 (Eruption), same as Natural — so the shipped
//                 Natural+Pinch set needs no harmonicValue write

function load(name: string): model.Score {
  const path = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
  const score = importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(path)), new Settings())
  score.finish(new Settings())
  return score
}

function* allBeats(score: model.Score): Generator<model.Beat> {
  for (const t of score.tracks)
    for (const st of t.staves)
      for (const bar of st.bars)
        for (const v of bar.voices)
          for (const beat of v.beats) yield beat
}

describe('fixture 4b-2: tremolo / grace / pinch-harmonic value scale', () => {
  it('tremolo: real beats populate beat.tremoloSpeed (the canonical setter), e.g. Sixteenth', () => {
    const tremolo = [...allBeats(load('sample_harmonic.gp4'))].filter((b) => b.tremoloSpeed != null)
    expect(tremolo.length).toBeGreaterThan(0)
    // Each speed is a real Duration value (a positive note-value enum). The fixture carries speeds
    // beyond our 8th/16th/32nd presets (e.g. Quarter=4) — real files aren't limited to our set — but
    // it confirms Sixteenth (16), the value our 16th preset writes, round-trips through a real import.
    for (const b of tremolo) expect(b.tremoloSpeed).toBeGreaterThan(0)
    expect(tremolo.some((b) => b.tremoloSpeed === model.Duration.Sixteenth)).toBe(true)
  })

  it('grace: a grace note is a SEPARATE beat (graceType set, displayDuration 0) — not a main-beat flag', () => {
    const grace = [...allBeats(load('sample_harmonic.gp4'))].filter((b) => b.graceType !== model.GraceType.None)
    expect(grace.length).toBeGreaterThan(0)
    for (const g of grace) {
      // It's its own beat: carries a graceType AND borrows no bar time (the defining property that a
      // flag-toggle on the user's beat could never produce without destroying that beat's duration).
      expect(g.graceType).not.toBe(model.GraceType.None)
      expect(g.displayDuration).toBe(0)
      expect(g.notes.length).toBeGreaterThan(0) // carries its own pitch
    }
  })

  it('pinch harmonics carry harmonicValue 0 (Eruption) — same scale as Natural, no value write needed', () => {
    const pinch = [...allBeats(load('sample_whammy_dive_full_bend.gp4'))]
      .flatMap((b) => b.notes)
      .filter((n) => n.harmonicType === model.HarmonicType.Pinch)
    expect(pinch.length).toBeGreaterThan(0)
    for (const n of pinch) expect(n.harmonicValue).toBe(0)
  })
})
