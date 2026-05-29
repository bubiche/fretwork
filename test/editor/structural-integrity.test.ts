import { describe, it, expect } from 'vitest'
import { model, Settings } from '@coderline/alphatab'
import { InsertBeatCommand, DeleteBeatCommand } from '../../src/editor/commands'
import { resolveVoice } from '../../src/editor/selection'
import type { BeatRef } from '../../src/editor/selection'
import { makeMinimalScore } from '../fixtures/makeMinimalScore'

// PHASE_3 §What the snapshot test does NOT cover, Hole 1: the snapshot reads array POSITIONS and
// only {duration, dots, string, fret}. It can't see beat.index, the nextBeat/previousBeat chain, or
// ticks — the precise things finish() repairs after a structural edit. So the structural commands
// need THIS test (not the round-trip) to guard them: apply (and undo), run finish(), and assert the
// model invariants directly. finish() needs a Settings; construct one (no api required).

const ref = (barIndex: number, beatIndex: number): BeatRef => ({
  trackIndex: 0,
  staffIndex: 0,
  voiceIndex: 0,
  barIndex,
  beatIndex,
})

/** Within a single-bar/single-voice score, beat.index must equal array position and the chain must
 *  link consecutive beats (ends are null). (Multi-bar scores chain across bar boundaries — out of
 *  scope here, so these fixtures use one bar.) */
function assertIntegrity(voice: model.Voice) {
  const beats = voice.beats
  for (let i = 0; i < beats.length; i++) {
    expect(beats[i].index, `beat[${i}].index`).toBe(i)
    expect(beats[i].nextBeat, `beat[${i}].nextBeat`).toBe(i + 1 < beats.length ? beats[i + 1] : null)
    expect(beats[i].previousBeat, `beat[${i}].previousBeat`).toBe(i > 0 ? beats[i - 1] : null)
  }
}

function finishAll(score: model.Score) {
  score.finish(new Settings())
}

describe('structural integrity after Insert/DeleteBeat + finish()', () => {
  it('InsertBeat: index + chain are correct after finish, and after undo + finish', () => {
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 4 })
    finishAll(score) // baseline (as if imported)
    const voice = resolveVoice(score, ref(0, 0))!

    const cmd = new InsertBeatCommand(ref(0, 1))
    cmd.apply(score)
    finishAll(score)
    expect(voice.beats).toHaveLength(5)
    assertIntegrity(voice)

    cmd.undo(score)
    finishAll(score)
    expect(voice.beats).toHaveLength(4)
    assertIntegrity(voice)
  })

  it('a SECOND insert lands correctly (the stale-after.index hazard)', () => {
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 4 })
    finishAll(score)
    const voice = resolveVoice(score, ref(0, 0))!

    new InsertBeatCommand(ref(0, 1)).apply(score)
    finishAll(score)
    // Second insert AFTER the model has been restructured once.
    new InsertBeatCommand(ref(0, 3)).apply(score)
    finishAll(score)

    expect(voice.beats).toHaveLength(6)
    assertIntegrity(voice)
  })

  it('DeleteBeat: index + chain are correct after finish, and after undo restores both', () => {
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 4 })
    finishAll(score)
    const voice = resolveVoice(score, ref(0, 0))!

    const cmd = new DeleteBeatCommand(ref(0, 1))
    cmd.apply(score)
    finishAll(score)
    expect(voice.beats).toHaveLength(3)
    assertIntegrity(voice)

    cmd.undo(score)
    finishAll(score)
    expect(voice.beats).toHaveLength(4)
    assertIntegrity(voice)
  })

  it('front delete + undo keeps index/chain intact', () => {
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 4 })
    finishAll(score)
    const voice = resolveVoice(score, ref(0, 0))!

    const cmd = new DeleteBeatCommand(ref(0, 0))
    cmd.apply(score)
    finishAll(score)
    assertIntegrity(voice)

    cmd.undo(score)
    finishAll(score)
    expect(voice.beats).toHaveLength(4)
    assertIntegrity(voice)
  })
})
