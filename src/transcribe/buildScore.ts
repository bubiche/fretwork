// buildScore — turn transcribed note events into an alphaTab Score.
//
// Mirrors newScore.ts (buildBlankScore): we generate an alphaTex string and let the AlphaTexImporter
// construct the MasterBar/Bar/Voice/Beat/tuning graph, rather than hand-rolling the model (verbose and
// easy to get subtly wrong — see newScore.ts / clipboard.ts for why the codebase leans on alphaTab's own
// import/export round-trip). The importer's default track is already a standard-tuning 6-string guitar,
// which is exactly the target tuning, so we only have to emit the notes.
//
// The quantizer hands us a monophonic timeline of grid cells (one cell = 1/division of a whole note);
// this file renders it bar-by-bar:
//   • a run of cells becomes the fewest beats that sum to it, greedy largest-first, dotted values
//     allowed (`{d}`; 6 cells on a 16th grid = one dotted quarter, not quarter+eighth);
//   • empty cells become rests (`r.dur`);
//   • a note crossing a barline (or too lumpy for one beat) is split and tied — alphaTex writes a tie
//     destination as a `-` fret: `0.5.4 | -.5.4`;
//   • bars are 4/4 (no time-signature detection), separated by explicit `|` — alphaTex does NOT
//     auto-wrap bars. The final bar is left underfull rather than padded with trailing rests.
//
// alphaTex note syntax is `fret.string.duration` where `string` is the alphaTex string number (1 = high
// E … 6 = low E) and `duration` is the denominator (4 = quarter).
import { Settings, importer, model } from '@coderline/alphatab'
import type { NoteEventTime } from './basicPitch'
import { quantize, DEFAULT_GRID_DIVISION, type GridDivision, type PlacedNote } from './quantize'
import { DEFAULT_BPM } from './detectTempo'
import { assignFret, type FretPosition } from './fretAssign'

export interface BuildScoreResult {
  score: model.Score
  /** Simultaneous notes dropped by the monophonic collapse (from the quantizer). */
  dropped: NoteEventTime[]
  /** MIDI pitches that had no playable fret position and were skipped (their cells become rests). */
  unplayable: number[]
  /** Number of notes actually placed in the score (tie continuations not counted). */
  noteCount: number
}

/**
 * Build a Score from raw basic-pitch note events: quantize → fret-assign → alphaTex → import. Pure (no
 * persistence, no UI), mirroring buildBlankScore. An empty / all-unplayable input yields a blank one-bar
 * rest so the caller always gets an openable score.
 */
export function buildScoreFromNotes(
  notes: NoteEventTime[],
  title: string,
  bpm: number = DEFAULT_BPM,
  division: GridDivision = DEFAULT_GRID_DIVISION,
): BuildScoreResult {
  const { notes: placed, dropped } = quantize(notes, bpm, division)

  const playable: (PlacedNote & { pos: FretPosition })[] = []
  const unplayable: number[] = []
  for (const p of placed) {
    const pos = assignFret(p.midi)
    if (pos) playable.push({ ...p, pos })
    else unplayable.push(p.midi) // skipped → its cells fall into a gap and render as rest
  }

  const score = importTex(buildTex(playable, bpm, division), title)
  return { score, dropped, unplayable, noteCount: playable.length }
}

/** Assemble the alphaTex source: tempo header, then the rendered cell timeline. */
function buildTex(placed: (PlacedNote & { pos: FretPosition })[], bpm: number, division: GridDivision): string {
  // No notes placed → a single empty bar (whole rest), same shape as buildBlankScore's blank score.
  const body = placed.length === 0 ? 'r.1' : renderTimeline(placed, division)
  return `\\tempo ${bpm}\n.\n${body}`
}

/** One beat's worth of alphaTex: its length in cells, the duration denominator, and a dot flag. */
interface DurationPiece {
  cells: number
  denominator: number
  dotted: boolean
}

/** Legal beat lengths for this grid, largest first: every power-of-two denominator that fits the
 *  division, plus its dotted variant when the dot is still a whole number of cells. */
function durationPieces(division: GridDivision): DurationPiece[] {
  const pieces: DurationPiece[] = []
  for (let denominator = 1; denominator <= division; denominator *= 2) {
    const cells = division / denominator
    pieces.push({ cells, denominator, dotted: false })
    if (cells % 2 === 0) pieces.push({ cells: cells * 1.5, denominator, dotted: true })
  }
  return pieces.sort((a, b) => b.cells - a.cells)
}

/** Render the monophonic cell timeline to alphaTex bars. In 4/4 a bar is `division` cells long. */
function renderTimeline(placed: (PlacedNote & { pos: FretPosition })[], division: GridDivision): string {
  const pieces = durationPieces(division)
  const bars: string[][] = []
  const pushToken = (cell: number, token: string) => {
    const bar = Math.floor(cell / division)
    while (bars.length <= bar) bars.push([])
    bars[bar].push(token)
  }

  // Decompose [start, end) into beats, splitting at barlines; `token` renders one piece at its cell.
  const emitSpan = (start: number, end: number, token: (p: DurationPiece, first: boolean) => string) => {
    let cell = start
    let first = true
    while (cell < end) {
      const barEnd = (Math.floor(cell / division) + 1) * division
      let remaining = Math.min(end, barEnd) - cell
      while (remaining > 0) {
        const piece = pieces.find((p) => p.cells <= remaining)!
        pushToken(cell, token(piece, first))
        cell += piece.cells
        remaining -= piece.cells
        first = false
      }
    }
  }

  let cursor = 0
  for (const note of placed) {
    if (note.startCell > cursor) {
      emitSpan(cursor, note.startCell, (p) => `r.${p.denominator}${p.dotted ? '{d}' : ''}`)
    }
    const { fret, string } = note.pos
    // First piece carries the fret; continuations are tie destinations (`-` fret) on the same string.
    emitSpan(note.startCell, note.endCell, (p, first) => {
      return `${first ? fret : '-'}.${string}.${p.denominator}${p.dotted ? '{d}' : ''}`
    })
    cursor = note.endCell
  }

  return bars.map((tokens) => tokens.join(' ')).join(' | ')
}

function importTex(tex: string, title: string): model.Score {
  const imp = new importer.AlphaTexImporter()
  imp.logErrors = false
  imp.initFromString(tex, new Settings())
  const score = imp.readScore()
  score.title = title
  if (score.tracks[0]) score.tracks[0].name = 'Guitar'
  return score
}
