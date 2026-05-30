import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Settings, model, importer } from '@coderline/alphatab'
import {
  InsertMeasureCommand,
  DeleteMeasureCommand,
  SetKeySignatureCommand,
} from '../../src/editor/commands'
import { scoreSnapshot } from '../../src/editor/snapshot'
import type { BeatRef } from '../../src/editor/selection'

// ⚠ THE test that can actually catch a relink/finish bug. The finish-free property round-trip cannot:
// the crash this phase risks (stale Bar.index → out-of-bounds masterbar getter → Voice.finish reads
// `getFermata` of undefined) only manifests THROUGH finish(), and only on a genuinely MULTI-TRACK,
// multi-staff score where the all-tracks invariant can break. So this runs insert/delete measure on a
// real 13-track fixture WITH finish() after every op and asserts the bars-per-staff == masterbars
// invariant across EVERY staff of EVERY track. (Same blind-spot lesson as Phase 3's front-delete
// previousBeat bug — the snapshot can't see chain corruption.)

const fixturePath = fileURLToPath(new URL('../fixtures/sample_harmonic.gp4', import.meta.url))

function loadFixture(): model.Score {
  const bytes = new Uint8Array(readFileSync(fixturePath))
  const score = importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings())
  score.finish(new Settings())
  return score
}

const finish = (score: model.Score) => score.finish(new Settings())
const ref = (barIndex: number): BeatRef => ({
  trackIndex: 0,
  staffIndex: 0,
  voiceIndex: 0,
  barIndex,
  beatIndex: 0,
})

/** Assert bars-per-staff == masterbars across every staff of every track. Returns the masterbar count. */
function assertInvariant(score: model.Score): number {
  const m = score.masterBars.length
  for (const track of score.tracks)
    for (const staff of track.staves)
      expect(staff.bars.length, `track ${track.index} staff ${staff.index}`).toBe(m)
  return m
}

describe('Insert/Delete measure on a real multi-track score (finish-safety + invariant)', () => {
  it('is genuinely multi-track/multi-staff (so the invariant can actually break)', () => {
    const score = loadFixture()
    expect(score.tracks.length).toBeGreaterThan(1)
    assertInvariant(score)
  })

  it('insert → 2nd insert → delete → finish each: invariant holds and no finish() crash', () => {
    const score = loadFixture()
    const m0 = assertInvariant(score)

    new InsertMeasureCommand(ref(5)).apply(score)
    expect(() => finish(score)).not.toThrow()
    expect(assertInvariant(score)).toBe(m0 + 1)

    new InsertMeasureCommand(ref(10)).apply(score)
    expect(() => finish(score)).not.toThrow()
    expect(assertInvariant(score)).toBe(m0 + 2)

    new DeleteMeasureCommand(ref(3)).apply(score)
    expect(() => finish(score)).not.toThrow()
    expect(assertInvariant(score)).toBe(m0 + 1)
  })

  it('inserted bar gets a voice count matching its siblings (no under-voiced bar)', () => {
    const score = loadFixture()
    new InsertMeasureCommand(ref(5)).apply(score)
    finish(score)
    for (const track of score.tracks) {
      for (const staff of track.staves) {
        const siblingVoices = staff.bars[0].voices.length
        expect(staff.bars[6].voices.length, `track ${track.index} staff ${staff.index}`).toBe(siblingVoices)
      }
    }
  })

  it('apply (insert+delete) then undo-all + finish restores the original snapshot', () => {
    const score = loadFixture()
    const original = scoreSnapshot(score)

    const c1 = new InsertMeasureCommand(ref(5))
    const c2 = new DeleteMeasureCommand(ref(20))
    c1.apply(score)
    finish(score)
    c2.apply(score)
    finish(score)

    c2.undo(score)
    finish(score)
    c1.undo(score)
    finish(score)

    assertInvariant(score)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('delete bar 0 + finish does NOT crash and does NOT inject a tempo automation (clean undo)', () => {
    const score = loadFixture()
    const original = scoreSnapshot(score)
    const oldBar1Tempo = score.masterBars[1].tempoAutomations.length

    const cmd = new DeleteMeasureCommand(ref(0))
    cmd.apply(score)
    expect(() => finish(score)).not.toThrow()
    // The new first bar (old bar 1) keeps its own tempo automations — finish() does not inject the
    // score-tempo automation (that lives in ModelUtils.consolidate, import-time only).
    expect(score.masterBars[0].tempoAutomations.length).toBe(oldBar1Tempo)

    cmd.undo(score)
    finish(score)
    expect(scoreSnapshot(score)).toEqual(original) // clean inverse — no lingering automation
  })
})

describe('Key signature is current-track-only (does not fan out to other tracks)', () => {
  it('writing track 1 staff 0 leaves track 0 (and the masterbar proxy) untouched', () => {
    const score = loadFixture()
    const t0bar0 = score.tracks[0].staves[0].bars[0]
    const beforeT0 = { key: t0bar0.keySignature, type: t0bar0.keySignatureType }
    const beforeMasterProxy = score.masterBars[0].keySignature // proxy into track 0

    const at: BeatRef = { trackIndex: 1, staffIndex: 0, voiceIndex: 0, barIndex: 0, beatIndex: 0 }
    new SetKeySignatureCommand(at, model.KeySignature.A, model.KeySignatureType.Major).apply(score)

    expect(score.tracks[1].staves[0].bars[0].keySignature).toBe(model.KeySignature.A) // target changed
    expect(score.tracks[0].staves[0].bars[0].keySignature).toBe(beforeT0.key) // track 0 untouched
    expect(score.tracks[0].staves[0].bars[0].keySignatureType).toBe(beforeT0.type)
    expect(score.masterBars[0].keySignature).toBe(beforeMasterProxy) // proxy (track 0) untouched
  })
})
