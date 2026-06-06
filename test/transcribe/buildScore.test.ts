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

// All hand-authored cases use 120 BPM on the default 16th grid: one cell = 0.125 s, one bar = 2 s.
const BPM = 120
const CELL = 0.125

function note(pitchMidi: number, startTimeSeconds: number, amplitude = 0.8, durationSeconds = 0.4): NoteEventTime {
  return { pitchMidi, startTimeSeconds, durationSeconds, amplitude }
}

/** A clean monophonic melody, one quarter-length note every half second (4 cells at 120 BPM). */
function fixtureNotes(): NoteEventTime[] {
  return MIDI_SEQUENCE.map((m, i) => note(m, i * 0.5, 0.8, 0.48))
}

function allBeats(score: model.Score): model.Beat[] {
  score.finish(new Settings())
  return score.tracks[0].staves[0].bars.flatMap((bar) => bar.voices[0].beats)
}

/** Sounded pitches in order — rests and tie continuations excluded. alphaTab computes a note's MIDI
 *  pitch into `realValue` only after `finish()`. */
function pitchesOf(score: model.Score): number[] {
  return allBeats(score)
    .filter((b) => !b.isRest && !b.notes[0].isTieDestination)
    .map((b) => (b.notes[0] as unknown as { realValue: number }).realValue)
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
    const { notes: kept, dropped } = quantize(notes, BPM)
    expect(kept.map((n) => n.midi)).toEqual([40, 45])
    expect(dropped.map((n) => n.pitchMidi).sort((a, b) => a - b)).toEqual([52, 64])
  })

  it('merges overlapping re-onsets of the same held note into one', () => {
    const notes = [note(40, 0.0), note(40, 0.2), note(40, 0.4), note(43, 0.6), note(43, 0.8)]
    expect(quantize(notes, BPM).notes.map((n) => n.midi)).toEqual([40, 43])
  })

  it('merges an abutting same-pitch segment chain into one note (real model output shape)', () => {
    // basic-pitch slices a held note into back-to-back events, each starting exactly at the previous
    // one's end (the E2 chain from the captured fixture run). Zero overlap — the merge must accept
    // abutting segments or every held note splits into repeated shorter notes of the same pitch.
    const notes = [note(40, 0.0, 0.71, 0.0813), note(40, 0.0813, 0.72, 0.0697), note(40, 0.1509, 0.65, 0.2322)]
    const { notes: kept } = quantize(notes, BPM)
    expect(kept).toEqual([{ midi: 40, startCell: 0, endCell: 3 }]) // one note, 0–0.383 s ≈ 3 cells
  })

  it('keeps a deliberately repeated note ("E E") as two notes when the intervals do not overlap', () => {
    const notes = [note(40, 0.0, 0.8, 0.45), note(40, 0.5, 0.8, 0.45)]
    const { notes: kept } = quantize(notes, BPM)
    expect(kept).toEqual([
      { midi: 40, startCell: 0, endCell: 4 },
      { midi: 40, startCell: 4, endCell: 8 },
    ])
  })

  it('drops quiet pre-onset ghosts below the amplitude floor (they would shift the real onset)', () => {
    const ghost = note(43, 0.31, 0.18)
    const real = note(43, 0.38, 0.69)
    const { notes: kept, dropped } = quantize([ghost, real], BPM)
    expect(kept).toHaveLength(1)
    expect(dropped).toContain(ghost)
  })
})

describe('quantize (grid placement)', () => {
  it('snaps onsets and lengths to cells, anchored so the first onset is cell 0', () => {
    // Leading silence (mic warm-up) must not become rests: first onset 0.7 s in.
    const notes = [note(40, 0.7, 0.8, 0.48), note(45, 1.2, 0.8, 0.23)]
    const { notes: kept } = quantize(notes, BPM)
    expect(kept).toEqual([
      { midi: 40, startCell: 0, endCell: 4 }, // 0.48 s ≈ 4 cells (quarter)
      { midi: 45, startCell: 4, endCell: 6 }, // 0.23 s ≈ 2 cells (eighth)
    ])
  })

  it('truncates a note still sounding when the next onset arrives (monophonic)', () => {
    const notes = [note(40, 0.0, 0.8, 1.0), note(45, 0.5, 0.8, 0.5)]
    const { notes: kept } = quantize(notes, BPM)
    expect(kept).toEqual([
      { midi: 40, startCell: 0, endCell: 4 },
      { midi: 45, startCell: 4, endCell: 8 },
    ])
  })

  it('gives every note at least one cell, even shorter-than-a-cell blips', () => {
    const { notes: kept } = quantize([note(40, 0, 0.8, 0.01)], BPM)
    expect(kept).toEqual([{ midi: 40, startCell: 0, endCell: 1 }])
  })

  it('respects the grid division (the same clip coarsens on an 8th grid)', () => {
    const notes = [note(40, 0.0, 0.8, 0.3), note(45, 0.5, 0.8, 0.3)]
    // 8th grid at 120 BPM: cell = 0.25 s → 0.3 s rounds to one cell, and the sub-beat decay gap
    // before the next onset is filled.
    expect(quantize(notes, BPM, 8).notes).toEqual([
      { midi: 40, startCell: 0, endCell: 2 },
      { midi: 45, startCell: 2, endCell: 3 },
    ])
  })

  it('absorbs a sub-beat gap into the note (plucked-string decay is not a rest)', () => {
    // basic-pitch reports a duration only while the string clearly sounds, so detected notes "end"
    // well before the next onset; without gap fill this melody renders eighth-note + eighth-rest
    // pairs — staccato-littered tab for straightforwardly held quarters.
    const notes = [note(40, 0.0, 0.8, 0.2), note(43, 0.5, 0.8, 0.2), note(45, 1.0, 0.8, 0.2)]
    const { notes: kept } = quantize(notes, BPM)
    expect(kept).toEqual([
      { midi: 40, startCell: 0, endCell: 4 },
      { midi: 43, startCell: 4, endCell: 8 },
      { midi: 45, startCell: 8, endCell: 10 }, // last note: no next onset to fill to
    ])
  })

  // The real WebGL model output for transcribe-sample.wav (41 events, harmonics + re-onsets + ghosts)
  // must collapse to the 8-note melody at the clip's actual ~150 BPM. This pins the target output at
  // the unit level.
  it('collapses the real fixture model output to E2 G2 A2 B2 D3 B2 A2 G2', () => {
    const { notes: kept } = quantize(SAMPLE_RAW_NOTES, 150)
    expect(kept.map((n) => n.midi)).toEqual(MIDI_SEQUENCE)
    // The melody is straight quarters at 150 BPM and must come out as exactly that: every onset on a
    // beat, every note held to the next onset (the segment chains merge end-to-end, so no decay gaps
    // and no split repeats survive).
    expect(kept.map((n) => n.startCell)).toEqual([0, 4, 8, 12, 16, 20, 24, 28])
    expect(kept.map((n) => n.endCell)).toEqual([4, 8, 12, 16, 20, 24, 28, 32])
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

  it('renders quarter-length notes as quarters across bars, no spurious rests', () => {
    const { score } = buildScoreFromNotes(fixtureNotes(), 'Riff')
    const beats = allBeats(score)
    expect(beats).toHaveLength(MIDI_SEQUENCE.length)
    for (const b of beats) {
      expect(b.isRest).toBe(false)
      expect(b.duration).toBe(model.Duration.Quarter)
    }
    expect(score.tracks[0].staves[0].bars).toHaveLength(2) // 8 quarters in 4/4
  })

  it('renders a full-beat gap between notes as a rest (the gap-fill boundary)', () => {
    // Quarter at cell 0, then a quarter starting at cell 8 → the gap is exactly one beat (4 cells),
    // the smallest silence gap fill leaves alone, and it becomes a quarter rest.
    const notes = [note(40, 0.0, 0.8, 0.48), note(45, 1.0, 0.8, 0.48)]
    const beats = allBeats(buildScoreFromNotes(notes, 'Rest', BPM).score)
    expect(beats.map((b) => b.isRest)).toEqual([false, true, false])
    expect(beats[1].duration).toBe(model.Duration.Quarter)
  })

  it('renders short-duration detections as held beats, not note + rest pairs', () => {
    // The fixture melody with staccato-short detected durations: gap fill must yield the same clean
    // quarters as the long-duration fixtureNotes(), with no rests in between.
    const notes = MIDI_SEQUENCE.map((m, i) => note(m, i * 0.5, 0.8, 0.2))
    const beats = allBeats(buildScoreFromNotes(notes, 'Staccato', BPM).score)
    expect(beats.some((b) => b.isRest)).toBe(false)
    expect(beats).toHaveLength(MIDI_SEQUENCE.length)
    for (const b of beats.slice(0, -1)) expect(b.duration).toBe(model.Duration.Quarter)
    expect(beats[beats.length - 1].duration).toBe(model.Duration.Eighth) // last note: sounded length
  })

  it('renders a 3-cell note as a single dotted eighth (not eighth + sixteenth)', () => {
    const beats = allBeats(buildScoreFromNotes([note(40, 0, 0.8, 0.375)], 'Dot', BPM).score)
    expect(beats).toHaveLength(1)
    expect(beats[0].duration).toBe(model.Duration.Eighth)
    expect(beats[0].dots).toBe(1)
  })

  it('splits a note crossing the barline and ties the halves', () => {
    // 40 for a quarter, half-note rest, then 45 from beat 4 of bar 1 through beat 1 of bar 2.
    const notes = [note(40, 0.0, 0.8, 0.5), note(45, 1.5, 0.8, 1.0)]
    const { score, noteCount } = buildScoreFromNotes(notes, 'Tie', BPM)
    expect(noteCount).toBe(2) // tie continuation is not an extra note
    const bars = score.tracks[0].staves[0].bars
    expect(bars).toHaveLength(2)
    const bar2First = bars[1].voices[0].beats[0]
    expect(bar2First.isRest).toBe(false)
    expect(bar2First.notes[0].isTieDestination).toBe(true)
    expect((bar2First.notes[0] as unknown as { realValue: number }).realValue).toBe(45)
    expect(pitchesOf(score)).toEqual([40, 45])
  })

  it('preserves notes, rests, and ties through a GP7 round-trip (the actual open-as-new-file path)', () => {
    const notes = [note(40, 0.0, 0.8, 0.5), note(45, 1.5, 0.8, 1.0)]
    const { score } = buildScoreFromNotes(notes, 'Tie', BPM)
    const round = reload(exportGp7Bytes(score, new Settings()))
    expect(pitchesOf(round)).toEqual([40, 45])
    expect(round.tracks[0].staves[0].bars[1].voices[0].beats[0].notes[0].isTieDestination).toBe(true)
  })

  it('turns an unplayable pitch into a rest gap instead of compressing the timeline', () => {
    const notes = [note(39, 0.0, 0.8, 0.48), note(45, 0.5, 0.8, 0.48)] // 39 is below low E
    const { score, unplayable, noteCount } = buildScoreFromNotes(notes, 'Skip', BPM)
    expect(unplayable).toEqual([39])
    expect(noteCount).toBe(1)
    const beats = allBeats(score)
    expect(beats.map((b) => b.isRest)).toEqual([true, false])
    expect(pitchesOf(score)).toEqual([45])
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
