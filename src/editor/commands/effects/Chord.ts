import { model } from '@coderline/alphatab'
import type { Command } from '../../CommandStack'
import { store } from '../../store'
import { ScoreMutator } from '../../ScoreMutator'
import { resolveBeat, type BeatRef } from '../../selection'
import { execute } from '../../HistoryRouter'
import chordData from '../../chords.json'

/**
 * Named chord diagrams. A curated, bundled library (standard 6-string tuning only) that
 * alphaTab renders from the diagram data: `beat.chordId` indexes into `staff.chords` (a `Map` the
 * renderer reads), so assigning a chord is TWO writes — register the `Chord` in the staff lookup,
 * then point the beat at it by id. Removing is a single id write back to `null`.
 *
 * `ChordDef.strings` is **high-e (1st string) → low-E (6th)**, holding **absolute** fret numbers,
 * `-1` = muted/not played — the exact convention alphaTab's GP4 importer produces (verified against
 * `sample_chord.gp4`: open C `[0,1,0,2,3,-1]` = x32010, open D `[2,3,2,0,-1,-1]` = xx0232). The JSON
 * is authored to match, so a hand-built `Chord` round-trips identically to an imported one.
 */
export type ChordDef = {
  /** Display name; doubles as the `chordId` (unique across the library — enforced by chords.data.test). */
  name: string
  /** Absolute frets, high-e → low-E, length 6, `-1` = muted. */
  strings: number[]
  /** The fret the diagram window starts at (1-based). Default 1 (open / low-position shapes). */
  firstFret?: number
  /** Frets carrying a barre, if any. */
  barreFrets?: number[]
}

/** The bundled curated library (see chords.json). Standard 6-string only. */
export const CHORD_LIBRARY: ChordDef[] = chordData as ChordDef[]

/** The string count the curated library is authored for. The picker is disabled and the dispatcher
 *  no-ops on any track whose tuning differs — `Chord.strings.length` must equal the track's string
 *  count or the renderer reads past the tuning array. */
export const CHORD_TUNING_LENGTH = 6

/** Build a live alphaTab `Chord` from a library entry. Copies the arrays so the command/undo state
 *  never shares references with the bundled data. `chord.staff` is set later by `addChord`. */
export function buildChord(def: ChordDef): model.Chord {
  const chord = new model.Chord()
  chord.name = def.name
  chord.strings = [...def.strings]
  chord.firstFret = def.firstFret ?? 1
  chord.barreFrets = def.barreFrets ? [...def.barreFrets] : []
  chord.showName = true
  chord.showDiagram = true
  chord.showFingering = false
  return chord
}

/**
 * Assign (or clear, with `chordId/chord = null`) a chord diagram on a beat. Beat-level.
 *
 * Mirrors {@link SetTremoloCommand}'s captured-BOOLEAN guard, NOT the `=== null` sentinel: `null`
 * is the legal "no chord" value (a cleared beat), so it can't double as "uncaptured".
 *
 * **Registry lifecycle — leaving a switched-away chord registered is NOT harmless.** alphaTab's
 * chord-diagram overview band renders *every* entry in `staff.chords`, not just
 * chords a beat points at. So if switching `C`→`Cm` left `C` registered, a ghost `C` diagram lingers
 * in the band (confirmed in-app). Therefore: on apply, after re-pointing the beat, **garbage-collect
 * the prior chord if no beat references it anymore** (surgical — only the chord this edit orphaned,
 * never pre-existing imported orphans). Undo restores the prior `chordId` AND the exact prior chord
 * map (a captured clone) — bulletproof against the add/remove bookkeeping. `relayout:'voice'` — the
 * diagram renders in an above-bar band that `finish()` builds. (The snapshot doesn't capture the map,
 * so the property round-trip is unaffected either way — this is purely render correctness.)
 */
export class SetChordCommand implements Command {
  readonly relayout = 'voice' as const
  private captured = false
  private prior: string | null = null
  private priorChords: Map<string, model.Chord> | null = null
  private at: BeatRef
  private chordId: string | null
  private chord: model.Chord | null

  constructor(at: BeatRef, chordId: string | null, chord: model.Chord | null) {
    this.at = at
    this.chordId = chordId
    this.chord = chord
  }

  apply(score: model.Score): void {
    const beat = resolveBeat(score, this.at)
    if (!beat) return
    const m = new ScoreMutator(score)
    if (!this.captured) {
      this.prior = beat.chordId
      this.priorChords = m.snapshotChords(this.at) // exact registry to restore on undo
      this.captured = true
    }
    if (this.chordId && this.chord) m.ensureChordRegistered(this.at, this.chordId, this.chord)
    m.setChord(this.at, this.chordId)
    // GC the chord this edit just orphaned (the ghost-diagram fix). Surgical: only the prior id.
    if (this.prior && this.prior !== this.chordId && !m.isChordReferenced(this.at, this.prior))
      m.unregisterChord(this.at, this.prior)
  }

  undo(score: model.Score): void {
    if (!this.captured) return
    const m = new ScoreMutator(score)
    m.setChord(this.at, this.prior)
    m.restoreChords(this.at, this.priorChords)
  }

  describe(): string {
    return this.chordId
      ? `Chord ${this.chordId} on beat ${this.at.beatIndex}`
      : `Clear chord on beat ${this.at.beatIndex}`
  }
}

/** Whether the chord picker applies to the given staff (curated library is standard 6-string). The
 *  panel reads this to disable the whole Chord group on bass/7-string tracks. */
export function chordPickerEnabled(staff: model.Staff | null | undefined): boolean {
  return !!staff && staff.tuning.length === CHORD_TUNING_LENGTH
}

/**
 * Assign the named chord to the selected beat. No-op when the track isn't standard 6-string (the
 * panel disables the control too, but the dispatcher must be safe for any future caller) or when the
 * beat already carries this chord (avoids a no-op command, mirrors the slide/tremolo dispatchers).
 */
export function setSelectedChord(def: ChordDef): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  const beat = resolveBeat(api.score, selection)
  if (!beat) return
  if (beat.voice.bar.staff.tuning.length !== CHORD_TUNING_LENGTH) {
    console.warn(
      `Chord library is ${CHORD_TUNING_LENGTH}-string only; track has ${beat.voice.bar.staff.tuning.length} strings — skipping`,
    )
    return
  }
  if (beat.chordId === def.name) return
  execute(new SetChordCommand(selection, def.name, buildChord(def)))
}

/** Clear the chord from the selected beat. No-op (pushes nothing) when there's no chord. */
export function clearSelectedChord(): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  const beat = resolveBeat(api.score, selection)
  if (!beat || beat.chordId == null) return
  execute(new SetChordCommand(selection, null, null))
}
