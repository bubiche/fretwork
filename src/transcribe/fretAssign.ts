// Fret assignment — deliberately "greedy" first pass.
//
// One pitch maps to several string/fret positions. Good tab minimizes hand movement and respects
// playability and reachable spans — that's the job of a real cost-minimizing assigner, which this is
// not. This is per-note and memoryless: pick the playable position with the lowest fret (which biases
// low notes onto
// the low strings and keeps everything near the nut). No hand-position continuity, no open-string
// preference beyond "lowest fret wins". Deliberately crude.
//
// String numbers here are **alphaTex** string numbers (1 = high E, the first tuning entry; 6 = low E),
// because the only consumer is buildScore.ts emitting alphaTex. alphaTab's internal `Note.string` is the
// inverse of this — we never touch it; the alphaTex importer does the conversion.

/** Standard 6-string tuning as MIDI open-string pitches, indexed by alphaTex string number − 1.
 *  alphaTex string 1 = high E4 (64) … string 6 = low E2 (40). */
export const STANDARD_TUNING_TEX: readonly number[] = [64, 59, 55, 50, 45, 40]

/** Highest fret we'll assign. 24 covers a two-octave electric neck; out-of-range pitches are unplayable. */
export const MAX_FRET = 24

export interface FretPosition {
  /** alphaTex string number (1 = high E … 6 = low E). */
  string: number
  fret: number
}

/**
 * Greedy lowest-fret assignment for a single MIDI pitch. Returns `null` when no string can reach the
 * pitch within [0, MAX_FRET] (i.e. the note is below the lowest open string or absurdly high). Pure.
 */
export function assignFret(midi: number, tuning: readonly number[] = STANDARD_TUNING_TEX): FretPosition | null {
  let best: FretPosition | null = null
  for (let s = 0; s < tuning.length; s++) {
    const fret = midi - tuning[s]
    if (fret < 0 || fret > MAX_FRET) continue
    if (best === null || fret < best.fret) best = { string: s + 1, fret }
  }
  return best
}
