import { describe, it, expect } from 'vitest'
import { Settings, importer, model } from '@coderline/alphatab'
import { buildBlankScore } from '../../src/persistence/newScore'
import { exportGp7Bytes } from '../../src/persistence/export'
import { AddNoteCommand } from '../../src/editor/commands'
import { resolveNote } from '../../src/editor/ScoreMutator'
import type { BeatRef } from '../../src/editor/selection'

const beat0: BeatRef = { trackIndex: 0, staffIndex: 0, voiceIndex: 0, barIndex: 0, beatIndex: 0 }

function reload(bytes: Uint8Array): model.Score {
  const s = importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings())
  s.finish(new Settings())
  return s
}

describe('buildBlankScore', () => {
  it('is one standard-tuning 6-string guitar track with a single empty 4/4 bar', () => {
    const score = buildBlankScore('My Song')
    expect(score.title).toBe('My Song')
    expect(score.tracks).toHaveLength(1)

    const staff = score.tracks[0].staves[0]
    // alphaTex default guitar tuning, high → low: E4 B3 G3 D3 A2 E2.
    expect(staff.stringTuning.tunings).toEqual([64, 59, 55, 50, 45, 40])
    expect(staff.bars).toHaveLength(1)

    const beats = staff.bars[0].voices[0].beats
    expect(beats).toHaveLength(1)
    expect(beats[0].isRest).toBe(true)
  })

  it('survives a GP7 round-trip (this is how it gets persisted + reopened)', () => {
    const round = reload(exportGp7Bytes(buildBlankScore('Untitled'), new Settings()))
    expect(round.tracks).toHaveLength(1)
    expect(round.tracks[0].staves[0].bars).toHaveLength(1)
    expect(round.tracks[0].staves[0].bars[0].voices[0].beats[0].isRest).toBe(true)
  })

  // The whole point of a blank tab is that the next thing you do is put a note in it. Adding a note to
  // the bar's rest must flip it off `isRest` and survive export — i.e. "create AND edit" works.
  it('accepts a note on its rest beat, and the note survives a GP7 round-trip', () => {
    const score = buildBlankScore('Riff')
    new AddNoteCommand(beat0, 1, 3).apply(score)

    const beat = score.tracks[0].staves[0].bars[0].voices[0].beats[0]
    expect(beat.isRest).toBe(false)
    expect(resolveNote(score, beat0, 1)!.fret).toBe(3)

    const round = reload(exportGp7Bytes(score, new Settings()))
    const rb = round.tracks[0].staves[0].bars[0].voices[0].beats[0]
    expect(rb.isRest).toBe(false)
    const note = rb.notes.find((n) => n.string === 1)!
    expect(note.fret).toBe(3)
  })
})
