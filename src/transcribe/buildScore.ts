// buildScore — turn transcribed note events into an alphaTab Score.
//
// Mirrors newScore.ts (buildBlankScore): we generate an alphaTex string and let the AlphaTexImporter
// construct the MasterBar/Bar/Voice/Beat/tuning graph, rather than hand-rolling the model (verbose and
// easy to get subtly wrong — see newScore.ts / clipboard.ts for why the codebase leans on alphaTab's own
// import/export round-trip). The importer's default track is already a standard-tuning 6-string guitar,
// which is exactly the target tuning, so we only have to emit the notes.
//
// alphaTex note syntax is `fret.string.duration` where `string` is the alphaTex string number (1 = high E
// … 6 = low E) and `duration` is the denominator (4 = quarter). alphaTex does NOT auto-wrap bars, so we
// emit an explicit `|` every BEATS_PER_BAR beats to keep 4/4 bars from overflowing into one giant bar.
import { Settings, importer, model } from '@coderline/alphatab'
import type { NoteEventTime } from './basicPitch'
import { quantize, HARDCODED_BPM } from './quantize'
import { assignFret } from './fretAssign'

/** 4/4, fixed for now (no time-signature detection). Beats per bar in the generated alphaTex. */
const BEATS_PER_BAR = 4

export interface BuildScoreResult {
  score: model.Score
  /** Simultaneous notes dropped by the monophonic collapse (from the quantizer). */
  dropped: NoteEventTime[]
  /** MIDI pitches that had no playable fret position and were skipped. */
  unplayable: number[]
  /** Number of notes actually placed in the score. */
  noteCount: number
}

/**
 * Build a Score from raw basic-pitch note events: quantize → fret-assign → alphaTex → import. Pure (no
 * persistence, no UI), mirroring buildBlankScore. An empty / all-unplayable input yields a blank one-bar
 * rest so the caller always gets an openable score.
 */
export function buildScoreFromNotes(notes: NoteEventTime[], title: string): BuildScoreResult {
  const { notes: quantized, dropped } = quantize(notes)

  const beats: string[] = []
  const unplayable: number[] = []
  for (const q of quantized) {
    const pos = assignFret(q.midi)
    if (!pos) {
      unplayable.push(q.midi)
      continue
    }
    beats.push(`${pos.fret}.${pos.string}.${q.durationDenominator}`)
  }

  const score = importTex(buildTex(beats), title)
  return { score, dropped, unplayable, noteCount: beats.length }
}

/** Assemble the alphaTex source: tempo header, then beats grouped into BEATS_PER_BAR-beat bars. */
function buildTex(beats: string[]): string {
  // No notes placed → a single empty bar (whole rest), same shape as buildBlankScore's blank score.
  const body = beats.length === 0 ? 'r.1' : groupIntoBars(beats)
  return `\\tempo ${HARDCODED_BPM}\n.\n${body}`
}

function groupIntoBars(beats: string[]): string {
  const bars: string[] = []
  for (let i = 0; i < beats.length; i += BEATS_PER_BAR) {
    bars.push(beats.slice(i, i + BEATS_PER_BAR).join(' '))
  }
  return bars.join(' | ')
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
