// Fret assignment — v2, cost-minimizing position assignment over the whole melody.
//
// One pitch maps to several string/fret positions; good tab minimizes fretting-hand movement, leans
// gently on open strings, and stays in a reachable region. v1 was per-note greedy (lowest fret wins),
// which is memoryless: it scatters a phrase to wherever each note happens to sit lowest, sliding the
// hand up and down the neck. v2 runs a Viterbi pass over the sequence — for each note we enumerate every
// playable position, then pick the path of positions with the least total cost.
//
// The cost model is deliberately minimal (there is no ground-truth fingering corpus to calibrate richer
// weights against — every extra knob is one we couldn't tune):
//   • transition (dominant): hand movement = |anchorFret − fret| along the neck, plus a small
//     per-string-crossing cost. The "Balanced" personality the project chose: minimize movement first,
//     with a gentle open-string nudge that never forces a shift.
//   • emission: a small open-string bonus (the nudge) and a mild fret-height penalty that breaks
//     otherwise-equal ties toward the nut.
//
// **Open strings and the hand anchor.** Plucking an open string does not move the fretting hand, so an
// open note's movement cost is 0 and it does *not* reset the hand position — it inherits the last
// *fretted* fret as the anchor. This avoids two opposite errors: a naive |fret−fret| distance would
// charge a phrase up at fret 8 for "travelling to fret 0 and back" to touch an open string (it didn't
// move); and pure open-zeroing without an anchor would *lose* the position after any open string and let
// the next note drift to the nut for free (a hidden shift — exactly the "big shift" Balanced forbids).
// Carrying the last fretted fret costs almost nothing and fixes both. Known limit: an open string
// *between* two distant fretted notes still hides that real shift (hand at 8 → open → fret 2 reads as
// free). Rare; accepted for v1.
//
// String numbers here are **alphaTex** string numbers (1 = high E, the first tuning entry; 6 = low E),
// because the only consumer is buildScore.ts emitting alphaTex. alphaTab's internal `Note.string` is the
// inverse of this — we never touch it; the alphaTex importer does the conversion.

/** Standard 6-string tuning as MIDI open-string pitches, indexed by alphaTex string number − 1.
 *  alphaTex string 1 = high E4 (64) … string 6 = low E2 (40). */
export const STANDARD_TUNING_TEX: readonly number[] = [64, 59, 55, 50, 45, 40]

/** Highest fret we'll assign. 24 covers a two-octave electric neck; out-of-range pitches are unplayable. */
export const MAX_FRET = 24

// Cost weights. FRET_W dominates so movement is the first thing minimized; STRING_W < FRET_W so a
// string crossing never outweighs a single fret of travel (it only breaks ties toward fewer crossings);
// HEIGHT_W is a faint nut-ward tie-breaker; OPEN_BONUS < FRET_W so the open-string nudge can tip a tie
// but never justifies moving the hand to reach an open string ("never forces a big shift").
const FRET_W = 1.0
const STRING_W = 0.2
const HEIGHT_W = 0.1
const OPEN_BONUS = 0.4

export interface FretPosition {
  /** alphaTex string number (1 = high E … 6 = low E). */
  string: number
  fret: number
}

/**
 * All playable positions for a MIDI pitch in the given tuning, lowest fret first. Empty when the pitch
 * is below the lowest open string or above every string's MAX_FRET. Pure.
 */
export function candidatePositions(midi: number, tuning: readonly number[] = STANDARD_TUNING_TEX): FretPosition[] {
  const out: FretPosition[] = []
  for (let s = 0; s < tuning.length; s++) {
    const fret = midi - tuning[s]
    if (fret >= 0 && fret <= MAX_FRET) out.push({ string: s + 1, fret })
  }
  return out.sort((a, b) => a.fret - b.fret)
}

/**
 * Greedy lowest-fret position for a single pitch (the v1 rule, kept as a primitive and for the playability
 * invariant: reproduces the pitch, or `null` when unreachable). Prefer `assignFrets` for real tab. Pure.
 */
export function assignFret(midi: number, tuning: readonly number[] = STANDARD_TUNING_TEX): FretPosition | null {
  return candidatePositions(midi, tuning)[0] ?? null
}

const emission = (pos: FretPosition): number =>
  HEIGHT_W * pos.fret + (pos.fret === 0 ? -OPEN_BONUS : 0)

/** Cost of moving from a previous node to a candidate position. Open notes cost no hand movement. */
const transition = (prev: Node, pos: FretPosition): number =>
  FRET_W * (pos.fret === 0 ? 0 : Math.abs(prev.anchor - pos.fret)) +
  STRING_W * Math.abs(prev.string - pos.string)

/** A Viterbi node: a chosen position for one playable note, plus the running cost, the hand anchor
 *  (last fretted fret, inherited through open notes), and a backpointer into the previous layer. */
interface Node {
  string: number
  fret: number
  anchor: number
  cost: number
  prev: number
}

/**
 * Assign a fret position to each pitch in `midis`, minimizing total fretting-hand movement across the
 * sequence (Viterbi). Returns one entry per input pitch in order; `null` for an unplayable pitch (its
 * slot becomes a rest downstream). Continuity bridges *across* unplayable holes — the hand doesn't
 * teleport because a pitch was skipped. Pure.
 */
export function assignFrets(
  midis: readonly number[],
  tuning: readonly number[] = STANDARD_TUNING_TEX,
): (FretPosition | null)[] {
  // Viterbi forward pass over playable notes only; holes (no candidate) carry the previous layer
  // forward so the next playable note transitions from the pre-hole hand position.
  const layers: Node[][] = []
  const layerOfNote: number[] = [] // note index → index into `layers`, or -1 for a hole
  let prevLayer: Node[] | null = null

  for (const midi of midis) {
    const candidates = candidatePositions(midi, tuning)
    if (candidates.length === 0) {
      layerOfNote.push(-1)
      continue // hole: prevLayer (the hand position) is unchanged
    }
    const layer: Node[] = candidates.map((pos) => {
      const anchor = pos.fret === 0 ? 0 : pos.fret // updated below from the chosen predecessor
      if (prevLayer === null) return { ...pos, anchor, cost: emission(pos), prev: -1 }
      let best = 0
      let bestCost = Infinity
      for (let k = 0; k < prevLayer.length; k++) {
        const c = prevLayer[k].cost + transition(prevLayer[k], pos)
        if (c < bestCost) (bestCost = c), (best = k)
      }
      // Open notes inherit the chosen predecessor's anchor (the hand didn't move); fretted notes anchor
      // on their own fret.
      const inherited = pos.fret === 0 ? prevLayer[best].anchor : pos.fret
      return { ...pos, anchor: inherited, cost: bestCost + emission(pos), prev: best }
    })
    layerOfNote.push(layers.length)
    layers.push(layer)
    prevLayer = layer
  }

  const result: (FretPosition | null)[] = midis.map(() => null)
  if (layers.length === 0) return result

  // Backtrack from the cheapest final node through the playable layers.
  const last = layers[layers.length - 1]
  let cur = 0
  for (let j = 1; j < last.length; j++) if (last[j].cost < last[cur].cost) cur = j
  const chosen: FretPosition[] = []
  for (let li = layers.length - 1; li >= 0; li--) {
    const node = layers[li][cur]
    chosen[li] = { string: node.string, fret: node.fret }
    cur = node.prev
  }
  for (let i = 0; i < midis.length; i++) {
    const li = layerOfNote[i]
    if (li >= 0) result[i] = chosen[li]
  }
  return result
}
