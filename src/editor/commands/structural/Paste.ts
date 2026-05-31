import type { model } from '@coderline/alphatab'
import type { Command } from '../../CommandStack'
import { resolveVoice, type BeatRef } from '../../selection'
import { ScoreMutator } from '../../ScoreMutator'

/**
 * Insert a riff (a flat list of beats lifted from a GP7 clone — see the `clipboard` dispatcher) into
 * the target voice immediately AFTER `at`, shifting existing beats right (PHASE_5 decision 1:
 * insert-and-shift, nothing overwritten). All beats land in `at`'s single bar/voice, so the bar may
 * overflow its time signature — alphaTab renders an overfull bar as-is; there is **no auto-rebar**
 * (out of scope, see PHASE_5 limitations). `relayout: 'voice'` so `finish()` reindexes/re-chains and
 * re-resolves any linked-note pointers the pasted beats carry (verified: a range whose tie/slide/HOPO
 * partner sat outside the copied region splices and finishes without dangling — see implementation
 * notes, build check #3).
 *
 * The beat objects are cached: undo splices the same objects back out by reference and redo re-splices
 * them (the InsertBeat discipline). Carried chord diagrams are registered into the TARGET staff so
 * `chordId` resolves there; undo restores the target staff's prior chord map (mirrors SetChordCommand).
 */
export class PasteCommand implements Command {
  readonly relayout = 'voice' as const
  private at: BeatRef
  private beats: model.Beat[]
  private chords: Map<string, model.Chord>
  private priorChords: Map<string, model.Chord> | null = null
  private captured = false

  /** @param at insert AFTER this beat. @param beats fresh clone beats (already decoupled from any
   *  live score). @param chords the `Chord` objects those beats reference, keyed by chordId. */
  constructor(at: BeatRef, beats: model.Beat[], chords: Map<string, model.Chord>) {
    this.at = at
    this.beats = beats
    this.chords = chords
  }

  apply(score: model.Score): void {
    const voice = resolveVoice(score, this.at)
    if (!voice) return
    const m = new ScoreMutator(score)
    if (!this.captured) {
      this.priorChords = m.snapshotChords(this.at) // exact registry to restore on undo
      this.captured = true
    }
    for (const [id, chord] of this.chords) m.ensureChordRegistered(this.at, id, chord)
    for (const beat of this.beats) beat.voice = voice
    voice.beats.splice(this.at.beatIndex + 1, 0, ...this.beats)
  }

  undo(score: model.Score): void {
    if (!this.captured) return
    const voice = resolveVoice(score, this.at)
    if (!voice) return
    for (const beat of this.beats) {
      const i = voice.beats.indexOf(beat)
      if (i >= 0) voice.beats.splice(i, 1)
    }
    new ScoreMutator(score).restoreChords(this.at, this.priorChords)
  }

  describe(): string {
    return `Paste ${this.beats.length} beat(s) after bar ${this.at.barIndex} beat ${this.at.beatIndex}`
  }
}
