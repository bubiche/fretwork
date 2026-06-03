// Quantizer — deliberately minimal first pass.
//
// basic-pitch hands us free-floating note events (onset/duration in seconds, polyphonic). Real rhythm
// work — snapping onsets to a tempo grid, quantizing note *lengths*, rests — is not done here yet. This
// stage does only enough to produce one clean note per played note:
//
//   1. Collapse near-simultaneous onsets to monophonic. Notes whose onsets fall within
//      COLLAPSE_WINDOW_SEC of each other are treated as one slot; we keep the **loudest** and set the
//      rest aside as `dropped` (inspectable for a future chord pass).
//   2. Merge consecutive runs of the same pitch into one note. basic-pitch re-onsets a single held note
//      several times; without this, one played note becomes 2–3 tab notes.
//   3. Emit a fixed duration per surviving note (a quarter). That's the "fixed grid": every note is one
//      grid cell, no length quantization. Deliberately crude — this stage exists to surface real output.
//
// Onsets/gaps are otherwise ignored (no rests, no real placement); that's left for the real quantizer.
//
// CALIBRATION NOTE (from running transcribe-sample.wav): a "keep the highest pitch" collapse rule is
// *wrong* for monophonic single-instrument audio — basic-pitch reports harmonics that are HIGHER in
// pitch but quieter than the fundamental, so highest-pitch kept the harmonic. Loudest-wins recovers the
// fundamental cleanly (fundamentals ~0.65–0.78, harmonics ~0.16–0.38 on the fixture). Two known
// fixture-tuned limits that the real quantizer will need to replace:
//   • merging equal pitches fuses a *legitimately* repeated note (e.g. melody "E E") into one;
//   • a played note shorter than COLLAPSE_WINDOW_SEC apart from its neighbour would be swallowed.
import type { NoteEventTime } from './basicPitch'

/** alphaTex duration denominator emitted for every note (4 = quarter note). */
export const FIXED_DURATION_DENOMINATOR = 4

/** Onsets closer together than this are considered the same slot and collapsed to one note. Sized to
 *  catch harmonics / chord tones that share an onset, while staying well under the gap between two
 *  deliberately-played melody notes (a 16th at 120 BPM is 125 ms). */
const COLLAPSE_WINDOW_SEC = 0.05

export interface QuantizedNote {
  /** MIDI pitch kept for this slot. */
  midi: number
  /** alphaTex duration denominator (1 = whole … 32). Always a quarter for now. */
  durationDenominator: number
}

export interface QuantizeResult {
  /** One note per time slot, in playback order. */
  notes: QuantizedNote[]
  /** Simultaneous notes removed by the monophonic collapse — kept for a future chord pass / inspection. */
  dropped: NoteEventTime[]
}

/** Collapse polyphony to a monophonic quarter-note sequence. Pure. */
export function quantize(notes: NoteEventTime[]): QuantizeResult {
  const ordered = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
  const dropped: NoteEventTime[] = []

  // 1) Slot near-simultaneous onsets and keep the loudest (harmonics are quieter than the fundamental).
  const slotPitches: number[] = []
  let i = 0
  while (i < ordered.length) {
    const slotStart = ordered[i].startTimeSeconds
    let j = i
    while (j < ordered.length && ordered[j].startTimeSeconds - slotStart <= COLLAPSE_WINDOW_SEC) j++
    const slot = ordered.slice(i, j)

    let keep = slot[0]
    for (const n of slot) {
      // loudest wins; break amplitude ties on the higher pitch (arbitrary but deterministic)
      if (n.amplitude > keep.amplitude || (n.amplitude === keep.amplitude && n.pitchMidi > keep.pitchMidi)) {
        keep = n
      }
    }
    for (const n of slot) if (n !== keep) dropped.push(n)
    slotPitches.push(keep.pitchMidi)
    i = j
  }

  // 2) Merge consecutive runs of the same pitch — basic-pitch re-onsets a single held note repeatedly.
  const out: QuantizedNote[] = []
  for (const midi of slotPitches) {
    if (out.length > 0 && out[out.length - 1].midi === midi) continue
    out.push({ midi, durationDenominator: FIXED_DURATION_DENOMINATOR })
  }

  return { notes: out, dropped }
}
