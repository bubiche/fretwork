import type { NoteEventTime } from '../../../src/transcribe/basicPitch'

// The actual 41 raw NoteEventTime[] basic-pitch produced for test/fixtures/transcribe-sample.wav on the
// WebGL backend (captured from an in-browser run). pitchBends are omitted — the quantizer ignores
// them. Kept verbatim so the monophonic collapse stays pinned to real model output, not idealised
// input. Note the segment chains: the model slices a held note into back-to-back same-pitch events,
// each starting exactly where the previous one ends (e.g. the three 40s at 0 / 0.08127 / 0.15093).
const RAW: [pitchMidi: number, startTimeSeconds: number, amplitude: number, durationSeconds: number][] = [
  [59, 0, 0.2232, 0.08127],
  [40, 0, 0.7104, 0.08127],
  [64, 0.02322, 0.309, 0.29025],
  [52, 0.03483, 0.3752, 0.27864],
  [40, 0.08127, 0.7222, 0.06966],
  [40, 0.15093, 0.6483, 0.2322],
  [43, 0.31347, 0.1841, 0.06966],
  [43, 0.38313, 0.6899, 0.15093],
  [67, 0.39474, 0.2901, 0.29025],
  [55, 0.42957, 0.3308, 0.27864],
  [43, 0.53406, 0.6499, 0.25542],
  [45, 0.71982, 0.2096, 0.06966],
  [45, 0.78948, 0.6906, 0.13932],
  [69, 0.80109, 0.3348, 0.13932],
  [57, 0.82431, 0.3311, 0.30186],
  [45, 0.9288, 0.6655, 0.25542],
  [47, 1.07973, 0.1902, 0.1161],
  [71, 1.19583, 0.3061, 0.32508],
  [47, 1.19583, 0.7203, 0.10449],
  [59, 1.21905, 0.3186, 0.31347],
  [47, 1.30032, 0.6729, 0.29025],
  [50, 1.48608, 0.1616, 0.10449],
  [74, 1.59057, 0.3112, 0.12771],
  [62, 1.59057, 0.2877, 0.35991],
  [50, 1.59057, 0.6819, 0.06966],
  [50, 1.66023, 0.6861, 0.32636],
  [47, 1.98659, 0.7272, 0.12771],
  [71, 1.9982, 0.3136, 0.30186],
  [59, 1.9982, 0.3115, 0.31347],
  [47, 2.1143, 0.7556, 0.17415],
  [47, 2.28845, 0.4618, 0.09288],
  [69, 2.39294, 0.3071, 0.15093],
  [45, 2.39294, 0.7253, 0.12771],
  [57, 2.41616, 0.3139, 0.31347],
  [45, 2.52065, 0.7823, 0.12771],
  [45, 2.64836, 0.5193, 0.13932],
  [43, 2.68319, 0.1666, 0.10449],
  [67, 2.78768, 0.2822, 0.15093],
  [43, 2.78768, 0.6692, 0.09288],
  [55, 2.82251, 0.3179, 0.30186],
  [43, 2.88056, 0.7168, 0.29025],
]

export const SAMPLE_RAW_NOTES: NoteEventTime[] = RAW.map(
  ([pitchMidi, startTimeSeconds, amplitude, durationSeconds]) => ({
    pitchMidi,
    startTimeSeconds,
    amplitude,
    durationSeconds,
  }),
)
