import { describe, it, expect, beforeEach } from 'vitest'
import { model, Settings } from '@coderline/alphatab'
import type { AlphaTabApi } from '@coderline/alphatab'
import {
  SetNoteEffectCommand,
  TieCommand,
  tieSelectedNote,
  setSelectedSlideOut,
} from '../../../../src/editor/commands'
import { scoreSnapshot } from '../../../../src/editor/snapshot'
import { resolveNote } from '../../../../src/editor/ScoreMutator'
import { store } from '../../../../src/editor/store'
import { clearHistory } from '../../../../src/editor/HistoryRouter'
import type { BeatRef } from '../../../../src/editor/selection'
import { makeMinimalScore } from '../../../fixtures/makeMinimalScore'

// Key finding: linked effects (HO/PO, let-ring, slide, tie) are SINGLE-FIELD writes;
// `Note.finish()` derives the origin↔destination pointers. The property harness is finish-free, so
// THIS test drives apply → finish → undo → finish (like structural-integrity.test.ts) to prove:
//   (1) finish() actually wires the derived pointers from the one flag we set, and
//   (2) undo restores the settable flag AND the round-trip snapshot is clean after finish() —
//       i.e. the auto-wiring doesn't leak derived state the snapshot can't see.
// A two-beat voice gives every note a same-string neighbour to wire to.

const ref = (beatIndex: number): BeatRef => ({
  trackIndex: 0,
  staffIndex: 0,
  voiceIndex: 0,
  barIndex: 0,
  beatIndex,
})

const finish = (score: model.Score) => score.finish(new Settings())

function twoBeatScore() {
  const score = makeMinimalScore({ bars: 1, beatsPerBar: 2, strings: 6 })
  finish(score) // baseline, as if freshly imported
  return score
}

describe('linked effects: finish()-driven wiring + clean undo', () => {
  it('HO/PO: finish wires origin→destination from the single flag; undo unwires + restores snapshot', () => {
    const score = twoBeatScore()
    const original = scoreSnapshot(score)
    const at = ref(0)

    const cmd = new SetNoteEffectCommand(at, 1, 'isHammerPullOrigin', true, { relayout: 'voice' })
    cmd.apply(score)
    finish(score)

    const origin = resolveNote(score, ref(0), 1)!
    const dest = resolveNote(score, ref(1), 1)!
    expect(origin.isHammerPullOrigin).toBe(true)
    expect(origin.hammerPullDestination).toBe(dest) // derived by finish() from one flag
    expect(dest.hammerPullOrigin).toBe(origin)
    expect(scoreSnapshot(score)).not.toEqual(original)

    cmd.undo(score)
    finish(score)
    expect(resolveNote(score, ref(0), 1)!.isHammerPullOrigin).toBe(false) // settable flag restored
    // NOTE: alphaTab's finish() is set-only for derived pointers — it wires hammerPullDestination
    // only `if (isHammerPullOrigin)` (core.mjs:6389) and never clears it when the flag goes false.
    // So the pointer stays STALE after undo. That's harmless: the renderer also guards on the flag
    // (`isHammerPullOrigin && hammerPullDestination`, :6415), and the snapshot captures only the
    // settable flag, not the pointer. The round-trip equality below is the real proof of cleanliness.
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('let-ring: finish derives letRingDestination; undo+finish restores the original snapshot', () => {
    const score = twoBeatScore()
    const original = scoreSnapshot(score)
    const at = ref(0)

    const cmd = new SetNoteEffectCommand(at, 1, 'isLetRing', true, { relayout: 'voice' })
    cmd.apply(score)
    finish(score)
    expect(resolveNote(score, ref(0), 1)!.isLetRing).toBe(true)
    expect(resolveNote(score, ref(0), 1)!.letRingDestination).not.toBeNull()

    cmd.undo(score)
    finish(score)
    expect(resolveNote(score, ref(0), 1)!.isLetRing).toBe(false)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('slide (Shift): finish derives slideTarget; undo+finish restores the original snapshot', () => {
    const score = twoBeatScore()
    const original = scoreSnapshot(score)
    const at = ref(0)

    const cmd = new SetNoteEffectCommand(at, 1, 'slideOutType', model.SlideOutType.Shift, {
      relayout: 'voice',
    })
    cmd.apply(score)
    finish(score)
    expect(resolveNote(score, ref(0), 1)!.slideOutType).toBe(model.SlideOutType.Shift)
    expect(resolveNote(score, ref(0), 1)!.slideTarget).toBe(resolveNote(score, ref(1), 1))

    cmd.undo(score)
    finish(score)
    expect(resolveNote(score, ref(0), 1)!.slideOutType).toBe(model.SlideOutType.None)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('tie: finish() copies the origin fret; undo tears down wiring so the fret survives a re-finish', () => {
    // The tie destination is the SECOND beat's note (chains back to its predecessor on the same
    // string). finish() copies the origin's fret onto it (11 → 1). The bug class: a single-field
    // undo restores isTieDestination but NOT fret, and even restoring fret is futile unless undo
    // also nulls tieOrigin — otherwise the post-undo finish() re-clobbers fret via the stale origin.
    const score = twoBeatScore()
    const original = scoreSnapshot(score)
    const at = ref(1)
    const destBefore = resolveNote(score, at, 1)!.fret
    const originFret = resolveNote(score, ref(0), 1)!.fret
    expect(destBefore).not.toBe(originFret) // distinct frets so the copy is observable

    const cmd = new TieCommand(at, 1)
    cmd.apply(score)
    finish(score)
    expect(resolveNote(score, at, 1)!.isTieDestination).toBe(true)
    expect(resolveNote(score, at, 1)!.fret).toBe(originFret) // finish copied the origin's fret

    cmd.undo(score)
    finish(score) // the re-finish that re-clobbers fret if tieOrigin wasn't nulled
    expect(resolveNote(score, at, 1)!.isTieDestination).toBe(false)
    expect(resolveNote(score, at, 1)!.fret).toBe(destBefore) // restored AND survived the re-finish
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('tie: redo re-applies the tie after an undo (capture-once does not snapshot the tied fret)', () => {
    const score = twoBeatScore()
    const at = ref(1)
    const originFret = resolveNote(score, ref(0), 1)!.fret

    const cmd = new TieCommand(at, 1)
    cmd.apply(score)
    finish(score)
    cmd.undo(score)
    finish(score)
    cmd.apply(score) // redo
    finish(score)
    expect(resolveNote(score, at, 1)!.isTieDestination).toBe(true)
    expect(resolveNote(score, at, 1)!.fret).toBe(originFret)
  })
})

describe('linked dispatchers: no-op guards', () => {
  let score: ReturnType<typeof makeMinimalScore>
  const at = ref(0)

  beforeEach(() => {
    clearHistory()
    score = makeMinimalScore({ bars: 1, beatsPerBar: 2, strings: 6 })
    // Settings-less fake api (skips finish() in afterMutation; the model write still runs).
    store.setState({
      api: { score, render() {} } as unknown as AlphaTabApi,
      selection: at,
      selectedString: 1,
      canUndo: false,
      canRedo: false,
    })
  })

  it('tieSelectedNote: no-op (pushes nothing) when the note is already a tie destination', () => {
    resolveNote(score, at, 1)!.isTieDestination = true
    tieSelectedNote()
    expect(store.getState().canUndo).toBe(false) // apply-only: already tied → nothing pushed
  })

  it('setSelectedSlideOut: no-op when picking the already-set type, applies when different', () => {
    expect(resolveNote(score, at, 1)!.slideOutType).toBe(model.SlideOutType.None)
    setSelectedSlideOut(model.SlideOutType.None) // same as current
    expect(store.getState().canUndo).toBe(false)

    setSelectedSlideOut(model.SlideOutType.Shift) // different → applies
    expect(store.getState().canUndo).toBe(true)
    expect(resolveNote(score, at, 1)!.slideOutType).toBe(model.SlideOutType.Shift)
  })
})
