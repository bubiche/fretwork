import { describe, it, expect } from 'vitest'
import type { NoteEventTime } from '../../src/transcribe/basicPitch'
import { detectTempo, MIN_BPM, MAX_BPM } from '../../src/transcribe/detectTempo'
import { SAMPLE_RAW_NOTES } from './fixtures/sampleRawNotes'

function note(pitchMidi: number, startTimeSeconds: number, amplitude = 0.8): NoteEventTime {
  return { pitchMidi, startTimeSeconds, durationSeconds: 0.2, amplitude }
}

/** A clean monophonic melody with one onset every `spacing` seconds (distinct pitches). */
function melody(spacing: number, count = 9): NoteEventTime[] {
  return Array.from({ length: count }, (_, i) => note(40 + (i % 12), i * spacing))
}

describe('detectTempo', () => {
  it('detects quarter notes at 120 BPM (0.5 s spacing)', () => {
    expect(detectTempo(melody(0.5))).toBe(120)
  })

  it('folds eighth-note spacing up into the band (0.25 s → 120, not 240)', () => {
    expect(detectTempo(melody(0.25))).toBe(120)
  })

  it('folds two-beat spacing down into the band (1.0 s → 120, not 60)', () => {
    expect(detectTempo(melody(1.0))).toBe(120)
  })

  it('recovers ~150 BPM from the real fixture model output (0.4 s melody spacing)', () => {
    // SAMPLE_RAW_NOTES is the captured basic-pitch output for transcribe-sample.wav: harmonics,
    // held-note re-onsets, and weak pre-onset ghosts included. Ground truth is one note per 0.4 s.
    const bpm = detectTempo(SAMPLE_RAW_NOTES)
    expect(bpm).not.toBeNull()
    expect(bpm!).toBeGreaterThanOrEqual(145)
    expect(bpm!).toBeLessThanOrEqual(155)
  })

  it('ignores harmonic notes sharing the onset and re-onsets of a held note', () => {
    // One played note per 0.5 s, each with a quieter octave harmonic at the same onset and a
    // same-pitch re-onset 0.15 s later — the noise pattern basic-pitch actually produces.
    const notes: NoteEventTime[] = []
    for (let i = 0; i < 8; i++) {
      const t = i * 0.5
      const midi = 40 + i
      notes.push(note(midi, t, 0.7), note(midi + 12, t + 0.01, 0.3), note(midi, t + 0.15, 0.65))
    }
    expect(detectTempo(notes)).toBe(120)
  })

  it('returns null on empty input', () => {
    expect(detectTempo([])).toBeNull()
  })

  it('returns null when there are too few onsets to trust', () => {
    expect(detectTempo([note(40, 0), note(43, 0.5), note(45, 1.0)])).toBeNull()
  })

  it('always reports an integer inside the band', () => {
    for (const spacing of [0.21, 0.33, 0.47, 0.61, 0.85, 1.3]) {
      const bpm = detectTempo(melody(spacing))
      expect(bpm).not.toBeNull()
      expect(Number.isInteger(bpm)).toBe(true)
      expect(bpm!).toBeGreaterThanOrEqual(MIN_BPM)
      expect(bpm!).toBeLessThanOrEqual(MAX_BPM)
    }
  })
})
