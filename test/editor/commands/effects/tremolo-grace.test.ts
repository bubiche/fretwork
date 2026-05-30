import { describe, it, expect, beforeEach } from 'vitest'
import { model, Settings } from '@coderline/alphatab'
import type { AlphaTabApi } from '@coderline/alphatab'
import {
  SetTremoloCommand,
  InsertGraceBeatCommand,
  TREMOLO_PRESETS,
  setSelectedTremolo,
  clearSelectedTremolo,
  setSelectedGrace,
} from '../../../../src/editor/commands'
import { scoreSnapshot } from '../../../../src/editor/snapshot'
import { resolveBeat, resolveVoice } from '../../../../src/editor/selection'
import { resolveNote } from '../../../../src/editor/ScoreMutator'
import { store } from '../../../../src/editor/store'
import { clearHistory } from '../../../../src/editor/HistoryRouter'
import type { BeatRef } from '../../../../src/editor/selection'
import { makeMinimalScore } from '../../../fixtures/makeMinimalScore'

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
  finish(score)
  return score
}

// ── Tremolo: nullable field, so capture must be a BOOLEAN flag (null is a legal value, not the
// "uncaptured" sentinel). finish()-driven because finish() derives tremoloPicking from tremoloSpeed.
describe('SetTremoloCommand: apply/finish/undo (nullable field, captured-flag)', () => {
  const sixteenth = TREMOLO_PRESETS.find((p) => p.id === 'sixteenth')!

  it('applies a 16th tremolo; finish derives tremoloPicking; undo clears it back to null', () => {
    const score = twoBeatScore()
    const original = scoreSnapshot(score)
    const at = ref(0)

    const cmd = new SetTremoloCommand(at, sixteenth.speed)
    cmd.apply(score)
    finish(score)

    const beat = resolveBeat(score, at)!
    expect(beat.tremoloSpeed).toBe(model.Duration.Sixteenth)
    expect(beat.isTremolo).toBe(true) // finish() derived this from the speed
    expect(beat.tremoloPicking).not.toBeNull() // and built the picking object

    cmd.undo(score)
    finish(score)
    const restored = resolveBeat(score, at)!
    expect(restored.tremoloSpeed).toBeNull()
    expect(restored.isTremolo).toBe(false) // derived state cleared, not stranded
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('undo restores a prior non-null speed (capture-flag does not mis-read it)', () => {
    const score = twoBeatScore()
    const at = ref(0)
    resolveBeat(score, at)!.tremoloSpeed = model.Duration.Eighth // pre-existing tremolo

    const cmd = new SetTremoloCommand(at, model.Duration.ThirtySecond)
    cmd.apply(score)
    finish(score)
    expect(resolveBeat(score, at)!.tremoloSpeed).toBe(model.Duration.ThirtySecond)

    cmd.undo(score)
    finish(score)
    expect(resolveBeat(score, at)!.tremoloSpeed).toBe(model.Duration.Eighth) // prior, not null
  })

  it('redo re-applies the speed after undo', () => {
    const score = twoBeatScore()
    const at = ref(0)
    const cmd = new SetTremoloCommand(at, sixteenth.speed)
    cmd.apply(score)
    finish(score)
    cmd.undo(score)
    finish(score)
    cmd.apply(score) // redo
    finish(score)
    expect(resolveBeat(score, at)!.tremoloSpeed).toBe(model.Duration.Sixteenth)
  })
})

// ── Grace: composite insert-before. Assert the grace beat lands before the selection with the copied
// pitch, finish() leaves it intact (does NOT clobber the pitch like a tie), and undo restores exactly.
describe('InsertGraceBeatCommand: apply/finish/undo (composite insert-before)', () => {
  it('inserts a grace beat before the selection carrying the note pitch; undo removes it', () => {
    const score = twoBeatScore()
    const original = scoreSnapshot(score)
    const at = ref(1) // second beat
    const mainFret = resolveNote(score, at, 1)!.fret
    const voice = resolveVoice(score, at)!

    const cmd = new InsertGraceBeatCommand(at, 1, model.GraceType.BeforeBeat)
    cmd.apply(score)
    finish(score)

    expect(voice.beats).toHaveLength(3)
    const grace = voice.beats[1] // landed before the (now index-2) main beat
    expect(grace.graceType).toBe(model.GraceType.BeforeBeat)
    expect(grace.notes[0].fret).toBe(mainFret) // pitch copied
    expect(grace.displayDuration).toBe(0) // finish() marks it as borrowing no bar time
    expect(voice.beats[2].graceType).toBe(model.GraceType.None) // the main beat is untouched

    // A SECOND finish must not clobber the grace pitch (the tie-style hazard this design avoids).
    finish(score)
    expect(voice.beats[1].notes[0].fret).toBe(mainFret)

    cmd.undo(score)
    finish(score)
    expect(voice.beats).toHaveLength(2)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('redo re-inserts the same grace beat (identity + pitch survive undo→redo)', () => {
    const score = twoBeatScore()
    const at = ref(1)
    const cmd = new InsertGraceBeatCommand(at, 1, model.GraceType.BeforeBeat)
    cmd.apply(score)
    finish(score)
    const snapAfter = scoreSnapshot(score)
    cmd.undo(score)
    finish(score)
    cmd.apply(score) // redo
    finish(score)
    expect(scoreSnapshot(score)).toEqual(snapAfter)
  })

  it('no-op on an empty string (no pitch to ornament)', () => {
    const score = twoBeatScore()
    const at = ref(0)
    const voice = resolveVoice(score, at)!
    voice.beats[0].removeNote(resolveNote(score, at, 4)!) // string 4 now empty
    const before = voice.beats.length
    const cmd = new InsertGraceBeatCommand(at, 4, model.GraceType.BeforeBeat) // string 4: no note
    cmd.apply(score)
    expect(voice.beats).toHaveLength(before) // nothing inserted
    expect(() => cmd.undo(score)).not.toThrow()
  })
})

describe('tremolo / grace dispatchers (no-op guards + selection)', () => {
  let score: ReturnType<typeof makeMinimalScore>
  const at = ref(0)

  beforeEach(() => {
    clearHistory()
    score = makeMinimalScore({ bars: 1, beatsPerBar: 2, strings: 6 })
    store.setState({
      api: { score, render() {} } as unknown as AlphaTabApi,
      selection: at,
      selectedString: 1,
      canUndo: false,
      canRedo: false,
    })
  })

  it('clearSelectedTremolo: no-op when no tremolo, removes when present', () => {
    clearSelectedTremolo()
    expect(store.getState().canUndo).toBe(false)
    setSelectedTremolo(TREMOLO_PRESETS[1])
    expect(resolveBeat(score, at)!.tremoloSpeed).toBe(model.Duration.Sixteenth)
    clearSelectedTremolo()
    expect(resolveBeat(score, at)!.tremoloSpeed).toBeNull()
  })

  it('setSelectedGrace: inserts before and advances the selection to the main beat', () => {
    const voice = resolveVoice(score, at)!
    setSelectedGrace(model.GraceType.BeforeBeat)
    expect(voice.beats).toHaveLength(3)
    expect(voice.beats[0].graceType).toBe(model.GraceType.BeforeBeat)
    // selection followed the original beat to its new index (was 0, now 1)
    expect(store.getState().selection!.beatIndex).toBe(1)
  })

  it('setSelectedGrace: no-op on an empty string', () => {
    resolveBeat(score, at)!.removeNote(resolveNote(score, at, 4)!) // empty string 4
    store.setState({ selectedString: 4 })
    setSelectedGrace()
    expect(store.getState().canUndo).toBe(false)
  })
})
