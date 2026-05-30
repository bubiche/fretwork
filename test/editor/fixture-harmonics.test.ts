import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Settings, model, importer } from '@coderline/alphatab'

// PHASE_4 §4b-2: the "verify against a real imported file" instruction for harmonics resolves against
// `sample_harmonic.gp4` ("Roundabout", a real GP4 export). It LOCKS the Natural-harmonic encoding:
// `note.harmonicType === HarmonicType.Natural` with `harmonicValue === 0` (pitch comes from the
// fret, not an offset). That's the only harmonic flavour this fixture carries — there are NO
// artificial/pinch/tap/semi harmonics here, so the `harmonicValue` *offset* scale those use stays
// UNVERIFIED by this fixture. If 4b-2 ships artificial-family harmonic presets, they need their own
// fixture (or the offset must be confirmed another way) before that scale can be called "locked".

const fixturePath = fileURLToPath(new URL('../fixtures/sample_harmonic.gp4', import.meta.url))

function loadFixture(): model.Score {
  const bytes = new Uint8Array(readFileSync(fixturePath))
  const score = importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings())
  score.finish(new Settings())
  return score
}

function harmonicNotes(score: model.Score): model.Note[] {
  const out: model.Note[] = []
  for (const track of score.tracks)
    for (const staff of track.staves)
      for (const bar of staff.bars)
        for (const voice of bar.voices)
          for (const beat of voice.beats)
            for (const note of beat.notes)
              if (note.harmonicType !== model.HarmonicType.None) out.push(note)
  return out
}

describe('fixture sample_harmonic.gp4: Natural-harmonic encoding (4b-2 verification)', () => {
  it('imports without error and is non-trivial', () => {
    const score = loadFixture()
    expect(score.title).toBe('Roundabout')
    expect(score.tracks.length).toBeGreaterThan(0)
  })

  it('carries Natural harmonics, and every harmonic in the file IS Natural', () => {
    const notes = harmonicNotes(loadFixture())
    expect(notes.length).toBeGreaterThan(0)
    // The whole point of the lock: this fixture's harmonics are exclusively Natural.
    for (const note of notes) expect(note.harmonicType).toBe(model.HarmonicType.Natural)
  })

  it('Natural harmonics carry NO pitch offset (harmonicValue === 0; pitch from the fret)', () => {
    const notes = harmonicNotes(loadFixture())
    for (const note of notes) {
      expect(note.harmonicValue).toBe(0)
      expect(note.fret).toBeGreaterThan(0) // sounds at a fret node (12, 7, 5, …), never open
    }
  })
})
