import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Settings, model, importer } from '@coderline/alphatab'

// 4b-3: the "verify against a real imported file" instruction for chord diagrams resolves
// against `sample_chord.gp4` ("Nothing Else Matters", a real GP4 export). It LOCKS the fact that
// alphaTab's GP4 importer preserves the chord-diagram library — `staff.chords` is populated and
// `beat.chord` resolves to a named diagram with full data (strings/firstFret/barre). This is the
// ground truth the chord-assignment commands will target, so a version bump that changes the chord
// representation trips here, not in unrelated command tests.

const fixturePath = fileURLToPath(new URL('../fixtures/sample_chord.gp4', import.meta.url))

function loadFixture(): model.Score {
  const bytes = new Uint8Array(readFileSync(fixturePath))
  const score = importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings())
  score.finish(new Settings())
  return score
}

const guitarStaff = (score: model.Score) => score.tracks[0].staves[0]

function beatsWithChord(score: model.Score): model.Beat[] {
  const out: model.Beat[] = []
  for (const track of score.tracks)
    for (const staff of track.staves)
      for (const bar of staff.bars)
        for (const voice of bar.voices)
          for (const beat of voice.beats) if (beat.chord) out.push(beat)
  return out
}

describe('fixture sample_chord.gp4: chord-diagram library (4b-3 verification)', () => {
  it('imports without error and is non-trivial', () => {
    const score = loadFixture()
    expect(score.title).toBe('Nothing Else Matters')
    expect(score.tracks.length).toBeGreaterThan(0)
    expect(guitarStaff(score).tuning.length).toBe(6) // standard 6-string guitar track
  })

  it('GP4 import PRESERVES the chord library (contradicts the old "importer drops chords" claim)', () => {
    const staff = guitarStaff(loadFixture())
    // staff.chords is a Map<string, Chord> keyed by chordId.
    expect(staff.chords).toBeTruthy()
    expect(staff.chords!.size).toBeGreaterThan(0)
  })

  it('every chord diagram has full data: 6-string fret array, firstFret, barre list', () => {
    const staff = guitarStaff(loadFixture())
    const chords = [...staff.chords!.values()]
    for (const chord of chords) {
      expect(chord.name.length).toBeGreaterThan(0)
      // one fret entry per string; -1 means the string is muted/not played.
      expect(chord.strings.length).toBe(staff.tuning.length)
      for (const fret of chord.strings) expect(fret).toBeGreaterThanOrEqual(-1)
      expect(chord.firstFret).toBeGreaterThanOrEqual(1)
      expect(Array.isArray(chord.barreFrets)).toBe(true)
    }
    // The variety we rely on for the chord UI is actually present:
    expect(chords.some((c) => c.strings.includes(-1))).toBe(true) // a muted string
    expect(chords.some((c) => c.barreFrets.length > 0)).toBe(true) // a barre chord
    expect(chords.some((c) => c.strings.every((f) => f >= 0))).toBe(true) // a full (no-mute) shape
  })

  it('beats reference chords by id, and beat.chord resolves to a diagram in the staff map', () => {
    const score = loadFixture()
    const staff = guitarStaff(score)
    const beats = beatsWithChord(score)
    expect(beats.length).toBeGreaterThan(0)
    for (const beat of beats) {
      // chordId is the link; beat.chord is the resolved diagram. They must agree with the staff map.
      expect(beat.chordId).toBeTruthy()
      expect(staff.chords!.get(beat.chordId!)).toBe(beat.chord)
    }
    // Sanity: real chord names from the song survive (open, barre, and slash/extended shapes).
    const names = new Set([...staff.chords!.values()].map((c) => c.name))
    for (const expected of ['Am', 'Em', 'D', 'C', 'G', 'B7'])
      expect(names.has(expected)).toBe(true)
  })
})
