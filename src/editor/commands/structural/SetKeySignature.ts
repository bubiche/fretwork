import type { model } from '@coderline/alphatab'
import type { Command } from '../../CommandStack'
import type { BeatRef } from '../../selection'
import { execute } from '../../HistoryRouter'
import { store } from '../../store'

/**
 * Change a bar's key signature, propagating forward **until the next pre-existing change** — the
 * same walk as time sig, but key sig is **per-`Bar` (per-staff)**, not per-`MasterBar`, and the
 * owner chose **current-track-only** scope. So this writes
 * `staff.bars[i].keySignature`/`keySignatureType` on the SELECTED track's staff only and does NOT
 * fan out to other tracks.
 *
 * ⚠ Deliberately does NOT write `MasterBar.keySignature` — that setter is a deprecated proxy into
 * `tracks[0].staves[0].bars[index]` (verified in core.mjs). Writing it would corrupt track 0 when
 * editing another track. The masterbar-level key sig can therefore diverge from non-track-0 staves;
 * flagged forward for the exporter to resolve (which track's value to write).
 */
export class SetKeySignatureCommand implements Command {
  readonly relayout = 'score' as const
  private at: BeatRef
  private key: model.KeySignature
  private type: model.KeySignatureType
  private changed: { index: number; oldKey: model.KeySignature; oldType: model.KeySignatureType }[] | null = null

  constructor(at: BeatRef, key: model.KeySignature, type: model.KeySignatureType) {
    this.at = at
    this.key = key
    this.type = type
  }

  apply(score: model.Score): void {
    const staff = score.tracks[this.at.trackIndex]?.staves[this.at.staffIndex]
    if (!staff) return
    const n = this.at.barIndex
    if (this.changed === null) {
      const start = staff.bars[n]
      if (!start) return
      const oldKey = start.keySignature
      const oldType = start.keySignatureType
      const captured: { index: number; oldKey: model.KeySignature; oldType: model.KeySignatureType }[] = []
      for (let i = n; i < staff.bars.length; i++) {
        const bar = staff.bars[i]
        if (bar.keySignature !== oldKey || bar.keySignatureType !== oldType) break
        captured.push({ index: i, oldKey: bar.keySignature, oldType: bar.keySignatureType })
      }
      this.changed = captured
    }
    for (const c of this.changed) {
      const bar = staff.bars[c.index]
      bar.keySignature = this.key
      bar.keySignatureType = this.type
    }
  }

  undo(score: model.Score): void {
    if (this.changed === null) return
    const staff = score.tracks[this.at.trackIndex]?.staves[this.at.staffIndex]
    if (!staff) return
    for (const c of this.changed) {
      const bar = staff.bars[c.index]
      if (bar) {
        bar.keySignature = c.oldKey
        bar.keySignatureType = c.oldType
      }
    }
  }

  describe(): string {
    return `Key signature ${this.key}/${this.type} at bar ${this.at.barIndex}`
  }
}

/** Set the selected bar's key signature on the selected track's staff only. */
export function setSelectedKeySignature(key: model.KeySignature, type: model.KeySignatureType): void {
  const { selection, api } = store.getState()
  if (!selection || !api?.score) return
  execute(new SetKeySignatureCommand(selection, key, type))
  // GP stores one key sig per bar at MasterBar level (= track 0), so a change on any other track is
  // dropped on save/export. Warn — don't block — since the in-model edit still applies + undoes,
  // and auto-save would otherwise make the loss silent on the next reload. Track 0 clears the warning.
  store.setState({
    warning:
      selection.trackIndex === 0
        ? null
        : "Key signature changes on this track won't be saved or exported — Guitar Pro keeps a single key signature per bar (the first track's). The change shows here but won't persist.",
  })
}
