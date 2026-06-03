import { describe, it, expect } from 'vitest'
import { Settings, importer, model } from '@coderline/alphatab'
import type { NoteEventTime } from '../../src/transcribe/basicPitch'
import { buildScoreFromNotes } from '../../src/transcribe/buildScore'
import { quantize } from '../../src/transcribe/quantize'
import { assignFret, STANDARD_TUNING_TEX } from '../../src/transcribe/fretAssign'
import { exportGp7Bytes } from '../../src/transcribe/../persistence/export'
import { SAMPLE_RAW_NOTES } from './fixtures/sampleRawNotes'

// The target melody: E2 G2 A2 B2 D3 B2 A2 G2 (the synthetic fixture's MIDI sequence). We
// hand-author the *ideal* basic-pitch output so the deterministic chain (quantize → fret-assign →
// buildScore) is provable without running the browser-only model. The real model run is verified
// end-to-end in the browser via window.__transcribe.
const MIDI_SEQUENCE = [40, 43, 45, 47, 50, 47, 45, 43]

function note(pitchMidi: number, startTimeSeconds: number, amplitude = 0.8): NoteEventTime {
  return { pitchMidi, startTimeSeconds, durationSeconds: 0.4, amplitude }
}

/** A clean monophonic melody, one note every half second. */
function fixtureNotes(): NoteEventTime[] {
  return MIDI_SEQUENCE.map((m, i) => note(m, i * 0.5))
}

/** alphaTab computes a note's MIDI pitch into `realValue` only after `finish()`. */
function pitchesOf(score: model.Score): number[] {
  score.finish(new Settings())
  return score.tracks[0].staves[0].bars.flatMap((bar) =>
    bar.voices[0].beats.filter((b) => !b.isRest).map((b) => (b.notes[0] as unknown as { realValue: number }).realValue),
  )
}

function reload(bytes: Uint8Array): model.Score {
  const s = importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings())
  s.finish(new Settings())
  return s
}

describe('fret assignment', () => {
  it('places each pitch on a playable string within fret range, reproducing the pitch', () => {
    for (const midi of MIDI_SEQUENCE) {
      const pos = assignFret(midi)!
      expect(pos).not.toBeNull()
      // alphaTex string `t` open pitch is STANDARD_TUNING_TEX[t-1]; pitch = open + fret.
      expect(STANDARD_TUNING_TEX[pos.string - 1] + pos.fret).toBe(midi)
      expect(pos.fret).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns null below the lowest open string', () => {
    expect(assignFret(39)).toBeNull() // a semitone below low E2 (40)
  })
})

describe('quantize (monophonic collapse)', () => {
  it('keeps the loudest note in a slot (the fundamental) and drops the quieter harmonics', () => {
    const notes: NoteEventTime[] = [
      note(40, 0.0, 0.9), // loud fundamental
      note(52, 0.01, 0.3), // quieter octave harmonic, same onset → dropped
      note(64, 0.02, 0.3), // quieter two-octave harmonic, same onset → dropped
      note(45, 1.0), // next slot
    ]
    const { notes: kept, dropped } = quantize(notes)
    expect(kept.map((n) => n.midi)).toEqual([40, 45])
    expect(dropped.map((n) => n.pitchMidi).sort((a, b) => a - b)).toEqual([52, 64])
  })

  it('merges consecutive re-onsets of the same held note into one', () => {
    // basic-pitch re-triggers a held note several times; the merge collapses the run.
    const notes = [note(40, 0.0), note(40, 0.2), note(40, 0.4), note(43, 0.6), note(43, 0.8)]
    expect(quantize(notes).notes.map((n) => n.midi)).toEqual([40, 43])
  })

  // The real WebGL model output for transcribe-sample.wav (41 events, harmonics + re-onsets) must
  // collapse to the 8-note melody. This pins the target output at the unit level.
  it('collapses the real fixture model output to E2 G2 A2 B2 D3 B2 A2 G2', () => {
    expect(quantize(SAMPLE_RAW_NOTES).notes.map((n) => n.midi)).toEqual(MIDI_SEQUENCE)
  })
})

describe('buildScoreFromNotes', () => {
  it('builds a standard-tuning guitar score whose notes are the melody, in order', () => {
    const { score, noteCount, dropped, unplayable } = buildScoreFromNotes(fixtureNotes(), 'Riff')
    expect(score.title).toBe('Riff')
    expect(score.tracks).toHaveLength(1)
    expect(noteCount).toBe(MIDI_SEQUENCE.length)
    expect(dropped).toHaveLength(0)
    expect(unplayable).toHaveLength(0)
    expect(pitchesOf(score)).toEqual(MIDI_SEQUENCE)
  })

  it('preserves the melody through a GP7 round-trip (the actual open-as-new-file path)', () => {
    const { score } = buildScoreFromNotes(fixtureNotes(), 'Riff')
    const round = reload(exportGp7Bytes(score, new Settings()))
    const pitches = round.tracks[0].staves[0].bars.flatMap((bar) =>
      bar.voices[0].beats
        .filter((b) => !b.isRest)
        .map((b) => (b.notes[0] as unknown as { realValue: number }).realValue),
    )
    expect(pitches).toEqual(MIDI_SEQUENCE)
  })

  // 8.3 plumbing: the detected/overridden BPM must reach the score's tempo marking and survive the
  // GP7 export → reload that the actual open-as-new-file path performs.
  it('writes the given BPM as the score tempo, through the GP7 round-trip', () => {
    const { score } = buildScoreFromNotes(fixtureNotes(), 'Riff', 140)
    expect(score.tempo).toBe(140)
    expect(reload(exportGp7Bytes(score, new Settings())).tempo).toBe(140)
  })

  it('defaults the tempo to 120 when no BPM is passed', () => {
    const { score } = buildScoreFromNotes(fixtureNotes(), 'Riff')
    expect(score.tempo).toBe(120)
  })

  it('yields a blank one-bar rest when there are no notes', () => {
    const { score, noteCount } = buildScoreFromNotes([], 'Empty')
    expect(noteCount).toBe(0)
    const beats = score.tracks[0].staves[0].bars[0].voices[0].beats
    expect(beats).toHaveLength(1)
    expect(beats[0].isRest).toBe(true)
  })
})
