import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Settings, model, importer } from '@coderline/alphatab'

// PHASE_4 §4b-0: every "verify against a real imported file" instruction resolves against an
// effects-bearing fixture. `sample_whammy_dive_full_bend.gp4` ("Eruption", a real GP4 export)
// carries bends, whammy dives, and pinch harmonics — enough to LOCK the bend/whammy value scale that
// 4b-1's presets are built on. (Eruption itself has no chord diagrams or grace beats, so the
// chord/grace verifications for 4b-2/4b-3 use their own fixtures — alphaTab's GP4 importer preserves
// chord libraries fine; sample_chord.gp4 imports 21 named chords with full diagram data.)

const fixturePath = fileURLToPath(
  new URL('../fixtures/sample_whammy_dive_full_bend.gp4', import.meta.url),
)

function loadFixture(): model.Score {
  const bytes = new Uint8Array(readFileSync(fixturePath))
  const score = importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings())
  score.finish(new Settings())
  return score
}

type Bend = { bendType: number; points: [number, number][] }
type Whammy = { whammyBarType: number; points: [number, number][] }

function collectBends(score: model.Score): Bend[] {
  const out: Bend[] = []
  for (const track of score.tracks)
    for (const bar of track.staves[0].bars)
      for (const voice of bar.voices)
        for (const beat of voice.beats)
          for (const note of beat.notes)
            if (note.hasBend)
              out.push({ bendType: note.bendType, points: note.bendPoints!.map((p) => [p.offset, p.value]) })
  return out
}

function collectWhammies(score: model.Score): Whammy[] {
  const out: Whammy[] = []
  for (const track of score.tracks)
    for (const bar of track.staves[0].bars)
      for (const voice of bar.voices)
        for (const beat of voice.beats)
          if (beat.hasWhammyBar)
            out.push({
              whammyBarType: beat.whammyBarType,
              points: beat.whammyBarPoints!.map((p) => [p.offset, p.value]),
            })
  return out
}

describe('fixture sample_whammy_dive_full_bend.gp4: effect value scale (4b-0 verification)', () => {
  it('imports without error and is non-trivial', () => {
    const score = loadFixture()
    expect(score.title).toBe('Eruption')
    expect(score.tracks.length).toBeGreaterThan(0)
    expect(score.tracks[0].staves[0].tuning.length).toBe(6) // standard 6-string
  })

  it('bend value scale: a full-step bend reaches value 4, a half-step value 2 (value/2 = semitones)', () => {
    const bends = collectBends(loadFixture())
    expect(bends.length).toBeGreaterThan(0)
    const peak = (b: Bend) => Math.max(...b.points.map((p) => p[1]))
    // The recipes claim full step = value 4, half step = value 2. Both must actually occur, on a
    // plain up-bend (BendType.Bend) — that's the preset our "Full step"/"½ step" buttons write.
    expect(bends.some((b) => b.bendType === model.BendType.Bend && peak(b) === 4)).toBe(true) // full
    expect(bends.some((b) => b.bendType === model.BendType.Bend && peak(b) === 2)).toBe(true) // half
    // No bend exceeds MaxValue (12 = 3 whole steps), bounding the quarter-tone scale we rely on.
    for (const b of bends) expect(peak(b)).toBeLessThanOrEqual(model.BendPoint.MaxValue)
  })

  it('whammy dives are negative (below pitch) and within the depth our presets use', () => {
    const whammies = collectWhammies(loadFixture())
    expect(whammies.length).toBeGreaterThan(0)
    const trough = (w: Whammy) => Math.min(...w.points.map((p) => p[1]))
    // At least one real dive goes below pitch; the deepest reaches −10, so the −8 in "Dive & return"
    // is in range. Offsets stay within MaxPosition (60).
    expect(whammies.some((w) => trough(w) < 0)).toBe(true)
    expect(Math.min(...whammies.map(trough))).toBeLessThanOrEqual(-8)
    for (const w of whammies)
      for (const [offset] of w.points) expect(offset).toBeLessThanOrEqual(model.BendPoint.MaxPosition)
  })
})
