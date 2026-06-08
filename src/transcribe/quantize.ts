// Quantizer v2 — real grid placement.
//
// basic-pitch hands us free-floating note events (onset/duration in seconds, polyphonic). This stage
// turns them into a monophonic timeline of grid cells (one cell = 1/division of a whole note at the
// given BPM), which buildScore renders bar-by-bar with durations, rests and ties:
//
//   1. Amplitude floor: drop notes quieter than AMP_FLOOR_RATIO of the clip's loudest. Kills the weak
//      "pre-onset" ghosts (~0.2 amp vs ~0.7 for real notes) that precede a true attack — they'd snap to
//      the wrong cell and shift the real onset. Same floor detectTempo uses, same calibration run.
//   2. Collapse near-simultaneous onsets to monophonic, **loudest wins** (harmonics are higher-pitched
//      but quieter than their fundamental). Collapse losers go to `dropped` for a future chord pass.
//   3. Merge same-pitch **segment chains**: basic-pitch slices one held note into several back-to-back
//      events, each starting within a frame (~12 ms hop) of where the previous one ends. Same-pitch
//      events that overlap or abut within a small tolerance are segments of one note; a genuinely
//      repeated note ("E E") has real silence between the pluck attacks and stays two notes — this
//      replaces v1's merge-all-equal-pitch rule, which fused legitimate repeats.
//   4. Snap onsets *and ends* to the grid, anchored so the first onset is cell 0 / beat 1 (leading mic
//      silence never becomes rests). Every note keeps at least one cell.
//   5. Monophonic cleanup on the grid: two onsets rounded into one cell → loudest wins; a note still
//      sounding when the next starts is truncated at the next onset.
//   6. Gap fill: a sub-beat gap before the next onset is decay, not silence — absorb it into the note.
//      basic-pitch reports a duration only while the string clearly sounds, so a plucked note "ends"
//      well before the next onset; rendering every such gap as a rest comes out staccato-littered.
//      Trust onsets, distrust durations. Only silences of a full beat or more survive as empty cells,
//      which buildScore renders as rests.
import type { NoteEventTime } from './basicPitch'

/** Grid divisions selectable in the UI: one cell = 1/division of a whole note (16 = 16th-note grid). */
export const GRID_DIVISIONS = [8, 16, 32] as const
export type GridDivision = (typeof GRID_DIVISIONS)[number]
// 8th-note grid by default. A real performance isn't metronomic, and a finer grid faithfully renders
// every few-ms onset jitter as an off-beat 16th — clean melodies come out littered with syncopation and
// ties. An 8th grid rounds that jitter back onto the beat (verified on a captured single-line clip: 0/12
// off-beat onsets, all quarters/halves, vs 1–2 stray 16ths at 16). Real 16th-note playing is the
// exception, and the UI still offers 16/32 for it.
export const DEFAULT_GRID_DIVISION: GridDivision = 8

/** Onsets closer together than this are the same attack (harmonics/chord tones share an onset within
 *  ~35 ms on the calibration run). At very fine grids (32nd cells at high BPM) this window exceeds a
 *  cell, so two real notes one cell apart would collapse — accepted; such playing is beyond v2.
 *  (Kept narrow on purpose: widening it lets the keep-loudest collapse swallow a held note's later,
 *  quieter segments before the same-pitch merge can fuse them, truncating the note.) */
const COLLAPSE_WINDOW_SEC = 0.05

/** Notes quieter than this fraction of the clip's loudest note are dropped before placement —
 *  calibrated against the pre-onset ghosts (~0.2 vs ~0.7) in the captured fixture run. */
const AMP_FLOOR_RATIO = 0.3

/** Lowest MIDI pitch we keep. Below the lowest standard-tuning open string (low E2 = 40) is unplayable
 *  on a 6-string guitar and in practice sub-bass rumble / octave-error ghosts from the model — dropping
 *  it pre-placement stops a stray low blip from anchoring the grid (cell 0 is the first surviving onset)
 *  or leaving phantom rests where it would otherwise sit. */
const MIN_MIDI = 40

/** Same-pitch events whose gap is at most this are segments of one held note. The model emits chain
 *  segments with a gap of exactly 0 (frame-aligned, ~12 ms hop on the captured run); ~2.5 frames of
 *  slack absorbs jitter while a deliberate repeat's silence between plucks stays a real gap. */
const MERGE_GAP_SEC = 0.03

export interface PlacedNote {
  /** MIDI pitch kept for this note. */
  midi: number
  /** Grid cell of the onset; cell 0 is the first onset in the clip. */
  startCell: number
  /** Exclusive end cell (`endCell - startCell` = length in cells, always ≥ 1). */
  endCell: number
}

export interface QuantizeResult {
  /** Monophonic notes on the grid, in playback order, non-overlapping. */
  notes: PlacedNote[]
  /** Notes removed before placement (below the amplitude floor, or simultaneous-onset collapse
   *  losers) — kept for a future chord pass / inspection. */
  dropped: NoteEventTime[]
}

/** Working interval between the preprocessing passes and the grid snap. */
interface Interval {
  midi: number
  start: number
  end: number
  amplitude: number
}

/** Place raw note events onto a monophonic rhythmic grid. Pure. */
export function quantize(
  notes: NoteEventTime[],
  bpm: number,
  division: GridDivision = DEFAULT_GRID_DIVISION,
): QuantizeResult {
  const dropped: NoteEventTime[] = []
  if (notes.length === 0) return { notes: [], dropped }

  // 0) Pitch gate: drop unplayable sub-bass before anything else, so it can't raise the amplitude floor
  //    or anchor the grid.
  const inRange: NoteEventTime[] = []
  for (const n of notes) (n.pitchMidi >= MIN_MIDI ? inRange : dropped).push(n)
  if (inRange.length === 0) return { notes: [], dropped }

  // 1) Amplitude floor.
  const maxAmp = Math.max(...inRange.map((n) => n.amplitude))
  const loud: NoteEventTime[] = []
  for (const n of inRange) (n.amplitude >= maxAmp * AMP_FLOOR_RATIO ? loud : dropped).push(n)
  loud.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)

  // 2) Slot near-simultaneous onsets and keep the loudest (the fundamental).
  const slotted: Interval[] = []
  let i = 0
  while (i < loud.length) {
    const slotStart = loud[i].startTimeSeconds
    let j = i
    while (j < loud.length && loud[j].startTimeSeconds - slotStart <= COLLAPSE_WINDOW_SEC) j++
    const slot = loud.slice(i, j)

    let keep = slot[0]
    for (const n of slot) {
      // loudest wins; break amplitude ties on the higher pitch (arbitrary but deterministic)
      if (n.amplitude > keep.amplitude || (n.amplitude === keep.amplitude && n.pitchMidi > keep.pitchMidi)) {
        keep = n
      }
    }
    for (const n of slot) if (n !== keep) dropped.push(n)
    slotted.push({
      midi: keep.pitchMidi,
      start: keep.startTimeSeconds,
      end: keep.startTimeSeconds + keep.durationSeconds,
      amplitude: keep.amplitude,
    })
    i = j
  }

  // 3) Merge same-pitch segment chains (overlapping or abutting events are one held note).
  const merged: Interval[] = []
  for (const n of slotted) {
    const prev = merged[merged.length - 1]
    if (prev && prev.midi === n.midi && n.start < prev.end + MERGE_GAP_SEC) {
      prev.end = Math.max(prev.end, n.end)
      prev.amplitude = Math.max(prev.amplitude, n.amplitude)
      continue
    }
    merged.push({ ...n })
  }

  // 4) Snap to the grid, anchored at the first surviving onset.
  const secPerCell = (60 / bpm) * (4 / division)
  const t0 = merged[0].start
  const placed: (PlacedNote & { amplitude: number })[] = []
  for (const m of merged) {
    const startCell = Math.round((m.start - t0) / secPerCell)
    const endCell = Math.max(startCell + 1, Math.round((m.end - t0) / secPerCell))
    placed.push({ midi: m.midi, startCell, endCell, amplitude: m.amplitude })
  }

  // 5) Monophonic cleanup on the grid: same-cell collisions → loudest wins; overlaps → truncate.
  const out: (PlacedNote & { amplitude: number })[] = []
  for (const p of placed) {
    const prev = out[out.length - 1]
    if (prev && p.startCell === prev.startCell) {
      // Two distinct attacks rounded into one cell — keep the louder, same rule as the onset collapse.
      if (p.amplitude > prev.amplitude) out[out.length - 1] = p
      continue
    }
    if (prev && prev.endCell > p.startCell) prev.endCell = p.startCell
    out.push(p)
  }

  // 6) Gap fill: extend a note over a following sub-beat gap (its own decay). One beat = division/4
  //    cells in 4/4; a gap of exactly a beat or more is kept as a deliberate rest. The last note has
  //    no next onset to fill to and keeps its sounded length.
  const beatCells = division / 4
  for (let k = 0; k < out.length - 1; k++) {
    const gap = out[k + 1].startCell - out[k].endCell
    if (gap > 0 && gap < beatCells) out[k].endCell = out[k + 1].startCell
  }

  return { notes: out.map(({ midi, startCell, endCell }) => ({ midi, startCell, endCell })), dropped }
}
