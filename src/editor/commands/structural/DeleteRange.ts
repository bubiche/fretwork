import { model } from '@coderline/alphatab'
import type { Command } from '../../CommandStack'
import type { BeatRange } from '../../selection'
import { severLinks, survivingLinkPartners, type RevertSever } from './linkSurgery'

/**
 * Delete every beat in a contiguous range (one track/staff/voice, may span bars) as ONE undoable
 * command (the pure model half of `cut`; the clipboard write lives in the dispatcher so
 * redo can't re-fire it). `relayout: 'voice'` so `finish()` reindexes/re-chains the survivors.
 *
 * Per the "no zero-beat voice" invariant (a bar whose voice empties is unrenderable), any bar fully
 * covered by the range collapses to a single synthesized quarter rest instead of vanishing — mirrors
 * the `beatToRest` rule, and matches how `InsertMeasure` seeds an empty bar.
 *
 * Removal is BY POSITION, recomputed and re-captured on every `apply` (the `DeleteBeatCommand`
 * discipline). NOT by cached object reference: an earlier command's redo can replace a bar's beats
 * with value-equal-but-different objects, and the snapshot can't tell them apart — so a by-reference
 * `indexOf` would silently no-op on redo. Positions are stable because the snapshot captures beat
 * counts, so any snapshot-equal restored state has identical per-bar lengths. Each `apply` captures
 * the objects it removed (and the rest it synthesized) for the matching `undo`.
 *
 * **Linked-note safety (shared with paste — see `linkSurgery`).** A range may split a tie/slur/HOPO/
 * slide pair: delete the inside end and the SURVIVING partner is left pointing at a detached note. The
 * main-thread `finish()` doesn't clear that stale pointer, so when alphaTab serializes to its render
 * WORKER (which re-links by id) the survivor emits a link id with no matching note → `noteIdLookup`
 * returns `undefined` → "Cannot set properties of undefined" crash (the same failure paste hit). After
 * splicing, each `apply` severs those survivor-side links and records a revert so `undo` re-ties them
 * when the deleted beat returns. Covers `cut` and paste-over-range, both of which run this command.
 */
type BarRemoval = {
  barIndex: number
  start: number // array index where the removed block began
  beats: model.Beat[] // the removed beats, by reference (preserves all notes/effects for undo)
  freshRest: model.Beat | null // a synthesized quarter rest, when this bar's voice was fully emptied
}

export class DeleteRangeCommand implements Command {
  readonly relayout = 'voice' as const
  private range: BeatRange
  private removed: BarRemoval[] | null = null // captured on the most recent apply, consumed by undo
  private revertSever: RevertSever | null = null // restores survivor-side links severed this apply

  constructor(range: BeatRange) {
    this.range = range
  }

  apply(score: model.Score): void {
    const r = this.range
    const staff = score.tracks[r.trackIndex]?.staves[r.staffIndex]
    if (!staff) return
    const removed: BarRemoval[] = []
    for (let b = r.fromBar; b <= r.toBar; b++) {
      const voice = staff.bars[b]?.voices[r.voiceIndex]
      if (!voice || voice.beats.length === 0) continue
      const start = b === r.fromBar ? r.fromBeat : 0
      const end = b === r.toBar ? Math.min(r.toBeat, voice.beats.length - 1) : voice.beats.length - 1
      if (end < start) continue
      const count = end - start + 1
      const beats = voice.beats.splice(start, count) // remove by position
      let freshRest: model.Beat | null = null
      if (voice.beats.length === 0) {
        freshRest = new model.Beat()
        freshRest.voice = voice
        voice.beats.push(freshRest) // the bar's lone rest
      }
      removed.push({ barIndex: b, start, beats, freshRest })
    }
    this.removed = removed

    // Sever any link from a SURVIVING note into the just-deleted set (and remember how to re-tie it on
    // undo). Without this, a tie/slide/HOPO split by the range leaves a dangling pointer that crashes
    // the render worker — see the class doc + `linkSurgery`.
    const deleted = new Set<model.Note>()
    for (const entry of removed) for (const beat of entry.beats) for (const note of beat.notes) deleted.add(note)
    const survivors = survivingLinkPartners(deleted, (n) => deleted.has(n))
    this.revertSever = severLinks(survivors, (partner) => deleted.has(partner))
  }

  undo(score: model.Score): void {
    if (!this.removed) return
    const r = this.range
    const staff = score.tracks[r.trackIndex]?.staves[r.staffIndex]
    if (!staff) return
    if (this.revertSever) {
      this.revertSever() // re-tie survivors BEFORE the deleted beats return, mirroring apply's order
      this.revertSever = null
    }
    for (const entry of this.removed) {
      const voice = staff.bars[entry.barIndex]?.voices[r.voiceIndex]
      if (!voice) continue
      if (entry.freshRest) {
        const i = voice.beats.indexOf(entry.freshRest)
        if (i >= 0) voice.beats.splice(i, 1)
      }
      for (const beat of entry.beats) beat.voice = voice
      voice.beats.splice(entry.start, 0, ...entry.beats)
    }
    this.removed = null
  }

  describe(): string {
    return `Delete range bar ${this.range.fromBar}.${this.range.fromBeat} → ${this.range.toBar}.${this.range.toBeat}`
  }
}
