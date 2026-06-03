// Tempo detection — handrolled inter-onset-interval (IOI) clustering over basic-pitch note events.
//
// Runs *after* inference (it consumes NoteEventTime[], not audio), so the UI shows the detected BPM
// once transcription finishes and lets the user override it before the tab is created. Detection only
// sets the score's tempo marking for now — note placement is still the fixed-grid quantizer.
//
// Raw model output is too noisy for naive consecutive-IOI math (verified on the captured fixture run):
// harmonics share an onset with their fundamental, a held note re-onsets every ~70–190 ms, and a weak
// "pre-onset" ghost (amplitude ~0.2 vs ~0.7 for real notes) often precedes the true attack. So the
// detector preprocesses with the same two moves as the quantizer's monophonic collapse (slot
// near-simultaneous onsets, merge consecutive same-pitch runs) plus a relative amplitude floor, then:
//
//   1. take IOIs between consecutive surviving onsets,
//   2. fold each IOI into the beat-period band for MIN_BPM..MAX_BPM by doubling/halving — an
//      eighth-note IOI and a two-beat IOI are octave aliases of the same tempo, and 70–160 spans
//      more than a factor of 2 so every IOI folds into the band,
//   3. cluster the folded periods (adjacent values within a relative tolerance) and report the
//      biggest cluster's mean as the BPM.
//
// Returns null when there isn't enough signal (too few onsets / no dominant cluster) — the caller
// falls back to DEFAULT_BPM and the UI override field is the safety net. Pure; unit-tested without
// the model.
import type { NoteEventTime } from './basicPitch'

/** Fallback when detection has too little signal to be trusted. */
export const DEFAULT_BPM = 120

/** Detected tempos are folded into this band (octave ambiguity: 80 BPM quarters ≡ 160 BPM eighths). */
export const MIN_BPM = 70
export const MAX_BPM = 160

/** Onsets closer than this are one slot — same sizing rationale as the quantizer's collapse window. */
const COLLAPSE_WINDOW_SEC = 0.05

/** Notes quieter than this fraction of the clip's loudest note are dropped before IOI analysis.
 *  Kills the low-amplitude pre-onset ghosts (~0.2 vs ~0.7 on the fixture) that would otherwise
 *  fragment every real beat interval; real harmonics also fall below it but are already removed by
 *  the onset collapse. */
const AMP_FLOOR_RATIO = 0.3

/** IOIs outside this absolute range are ignored: shorter is collapse-window dust, longer is a rest /
 *  phrase gap rather than rhythm. */
const MIN_IOI_SEC = 0.2
const MAX_IOI_SEC = 2.0

/** Adjacent folded periods within this relative gap belong to the same cluster. */
const CLUSTER_TOLERANCE = 0.06

/** Need at least this many usable IOIs overall, and this many in the winning cluster. */
const MIN_IOIS = 3
const MIN_CLUSTER_SIZE = 2

/**
 * Estimate the clip's tempo from raw basic-pitch note events. Returns an integer BPM in
 * [MIN_BPM, MAX_BPM], or null when the clip is too sparse/ambiguous to call.
 */
export function detectTempo(notes: NoteEventTime[]): number | null {
  const onsets = cleanOnsets(notes)

  // Consecutive IOIs, folded into the tempo band.
  const periods: number[] = []
  for (let i = 1; i < onsets.length; i++) {
    const ioi = onsets[i] - onsets[i - 1]
    if (ioi < MIN_IOI_SEC || ioi > MAX_IOI_SEC) continue
    periods.push(foldToBand(ioi))
  }
  if (periods.length < MIN_IOIS) return null

  const cluster = biggestCluster(periods)
  if (cluster.length < MIN_CLUSTER_SIZE) return null

  const mean = cluster.reduce((a, b) => a + b, 0) / cluster.length
  return Math.round(60 / mean)
}

/** Amplitude floor → onset collapse → same-pitch run merge. Returns surviving onset times, sorted. */
function cleanOnsets(notes: NoteEventTime[]): number[] {
  if (notes.length === 0) return []
  const maxAmp = Math.max(...notes.map((n) => n.amplitude))
  const loud = notes
    .filter((n) => n.amplitude >= maxAmp * AMP_FLOOR_RATIO)
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)

  // Collapse near-simultaneous onsets to one slot, keeping the loudest note's pitch (the fundamental).
  const slots: { onset: number; midi: number }[] = []
  let i = 0
  while (i < loud.length) {
    const slotStart = loud[i].startTimeSeconds
    let keep = loud[i]
    let j = i
    while (j < loud.length && loud[j].startTimeSeconds - slotStart <= COLLAPSE_WINDOW_SEC) {
      if (loud[j].amplitude > keep.amplitude) keep = loud[j]
      j++
    }
    slots.push({ onset: slotStart, midi: keep.pitchMidi })
    i = j
  }

  // Merge consecutive same-pitch slots (held-note re-onsets), keeping the run's first onset.
  const onsets: number[] = []
  let prevMidi = NaN
  for (const s of slots) {
    if (s.midi === prevMidi) continue
    onsets.push(s.onset)
    prevMidi = s.midi
  }
  return onsets
}

/** Double/halve a period until it lands in the [MAX_BPM, MIN_BPM] beat-period band. */
function foldToBand(period: number): number {
  const lo = 60 / MAX_BPM
  const hi = 60 / MIN_BPM
  let p = period
  while (p < lo) p *= 2
  while (p > hi) p /= 2
  return p
}

/** Largest group of values where each is within CLUSTER_TOLERANCE (relative) of its neighbour. */
function biggestCluster(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  let best: number[] = []
  let current: number[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i] - sorted[i - 1]) / sorted[i - 1] <= CLUSTER_TOLERANCE) {
      current.push(sorted[i])
    } else {
      if (current.length > best.length) best = current
      current = [sorted[i]]
    }
  }
  return current.length > best.length ? current : best
}
