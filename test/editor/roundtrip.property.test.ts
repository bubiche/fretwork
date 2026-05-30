import { describe, it, expect } from 'vitest'
import type { model } from '@coderline/alphatab'
import type { Command } from '../../src/editor/CommandStack'
import { model } from '@coderline/alphatab'
import {
  ChangeFretCommand,
  ChangeStringCommand,
  AddNoteCommand,
  DeleteNoteCommand,
  BeatToRestCommand,
  ChangeDurationCommand,
  InsertBeatCommand,
  DeleteBeatCommand,
  SetNoteEffectCommand,
  SetBeatEffectCommand,
  TieCommand,
  DURATION_LADDER,
  MAX_FRET,
} from '../../src/editor/commands'
import { scoreSnapshot } from '../../src/editor/snapshot'
import type { BeatRef } from '../../src/editor/selection'
import { makeMinimalScore } from '../fixtures/makeMinimalScore'

/**
 * PLAN's "critical invariant": a random sequence of Commands, applied in order and then undone in
 * reverse, must return the score to a snapshot deep-equal to the original.
 *
 * This is the property harness in its FINAL shape (PHASE_3 §What the snapshot test does NOT cover):
 *  - Targets are resolved against the LIVE score AT APPLY TIME (interleaved generate→apply), not
 *    frozen up front. Once Slice C adds Insert/DeleteBeat, frozen refs would shift and later
 *    commands would silently no-op; the round-trip would still pass with near-zero coverage.
 *  - A non-no-op TRIPWIRE counts how many commands actually mutated the snapshot and fails if that
 *    is implausibly low — a guard against silent under-coverage.
 *  - The model round-trip is valid WITHOUT finish(): resolveBeat reads array position, so value/
 *    note edits are honest even with stale indices. Structural-integrity (beat.index, chain) is
 *    guarded separately in structural-integrity.test.ts (Slice C), not here.
 *
 * Slice A seeds the generator with ChangeFret only; B and C push more generators into GENERATORS.
 */

// Deterministic PRNG (mulberry32) so a failing sequence reproduces from its seed.
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T,>(rand: () => number, arr: T[]): T => arr[Math.floor(rand() * arr.length)]

/** A generator builds a Command against the CURRENT score state, or returns null if it can't. */
type Generator = (score: model.Score, rand: () => number) => Command | null

/** Pick a random (barIndex, beatIndex, beat) on track 0 / staff 0 / voice 0, or null. */
function pickBeat(score: model.Score, rand: () => number) {
  const staff = score.tracks[0]?.staves[0]
  if (!staff || staff.bars.length === 0) return null
  const barIndex = Math.floor(rand() * staff.bars.length)
  const voice = staff.bars[barIndex].voices[0]
  if (!voice || voice.beats.length === 0) return null
  const beatIndex = Math.floor(rand() * voice.beats.length)
  const at: BeatRef = { trackIndex: 0, staffIndex: 0, voiceIndex: 0, barIndex, beatIndex }
  return { at, beat: voice.beats[beatIndex], strings: staff.tuning.length }
}

/** Change the fret of a random existing note. */
const genChangeFret: Generator = (score, rand) => {
  const p = pickBeat(score, rand)
  if (!p || p.beat.notes.length === 0) return null
  const note = pick(rand, p.beat.notes)
  return new ChangeFretCommand(p.at, note.string, Math.floor(rand() * (MAX_FRET + 1)))
}

/** Move a random note to a random free in-range string. */
const genChangeString: Generator = (score, rand) => {
  const p = pickBeat(score, rand)
  if (!p || p.beat.notes.length === 0) return null
  const note = pick(rand, p.beat.notes)
  const free: number[] = []
  for (let s = 1; s <= p.strings; s++) if (!p.beat.getNoteOnString(s)) free.push(s)
  if (free.length === 0) return null
  return new ChangeStringCommand(p.at, note.string, pick(rand, free))
}

/** Add a note on a random free string. */
const genAddNote: Generator = (score, rand) => {
  const p = pickBeat(score, rand)
  if (!p) return null
  const free: number[] = []
  for (let s = 1; s <= p.strings; s++) if (!p.beat.getNoteOnString(s)) free.push(s)
  if (free.length === 0) return null
  return new AddNoteCommand(p.at, pick(rand, free), Math.floor(rand() * (MAX_FRET + 1)))
}

/** Delete a random existing note. */
const genDeleteNote: Generator = (score, rand) => {
  const p = pickBeat(score, rand)
  if (!p || p.beat.notes.length === 0) return null
  return new DeleteNoteCommand(p.at, pick(rand, p.beat.notes).string)
}

/** Clear a random non-empty beat to a rest. */
const genBeatToRest: Generator = (score, rand) => {
  const p = pickBeat(score, rand)
  if (!p || p.beat.notes.length === 0) return null
  return new BeatToRestCommand(p.at)
}

/** Set a random beat to a random duration + dot count. */
const genChangeDuration: Generator = (score, rand) => {
  const p = pickBeat(score, rand)
  if (!p) return null
  const duration = pick(rand, DURATION_LADDER)
  return new ChangeDurationCommand(p.at, duration, rand() < 0.5 ? 1 : 0)
}

/** Insert an empty beat after a random beat. (Structural: round-trips finish-free because
 *  resolveBeat/snapshot read array position; structural-integrity.test.ts guards index/chain.) */
const genInsertBeat: Generator = (score, rand) => {
  const p = pickBeat(score, rand)
  if (!p) return null
  return new InsertBeatCommand(p.at)
}

/** Delete a random beat, but never the only beat in a voice (mirrors the dispatcher rule). */
const genDeleteBeat: Generator = (score, rand) => {
  const p = pickBeat(score, rand)
  if (!p) return null
  const voice = score.tracks[0].staves[0].bars[p.at.barIndex].voices[0]
  if (voice.beats.length <= 1) return null
  return new DeleteBeatCommand(p.at)
}

// ── Phase 4a effect generators ────────────────────────────────────────────────────────────────
// Each builds a single-field-set command against a random note (or beat) with a value GUARANTEED
// to differ from the current one, so a non-null command always mutates the snapshot — keeping the
// tripwire's mutation ratio honest. Linked effects round-trip finish-free because the snapshot
// holds only settable flags (array-position-independent); their finish()-driven wiring is asserted
// in effects/linked.test.ts, not here.

/** A value in [0, count) guaranteed != current. */
const diffEnum = (rand: () => number, current: number, count: number): number =>
  (current + 1 + Math.floor(rand() * (count - 1))) % count

/** Build a generator that flips a boolean note flag on a random note. */
const noteFlagGen =
  (key: 'isPalmMute' | 'isGhost' | 'isDead' | 'isLetRing' | 'isHammerPullOrigin',
   relayout: 'none' | 'voice'): Generator =>
  (score, rand) => {
    const p = pickBeat(score, rand)
    if (!p || p.beat.notes.length === 0) return null
    const note = pick(rand, p.beat.notes)
    return new SetNoteEffectCommand(p.at, note.string, key, !note[key], { relayout })
  }

/** Tie a random existing note (the real command we ship). Finish-free here, so it behaves like a
 *  plain isTieDestination flip and round-trips cleanly; the finish()-driven wiring + fret-teardown
 *  is asserted in effects/linked.test.ts. */
const genTie: Generator = (score, rand) => {
  const p = pickBeat(score, rand)
  if (!p || p.beat.notes.length === 0) return null
  const note = pick(rand, p.beat.notes)
  if (note.isTieDestination) return null // apply-only, matches the dispatcher
  return new TieCommand(p.at, note.string)
}

/** Set a note enum field to a different value. */
const noteEnumGen =
  (key: 'vibrato' | 'slideInType' | 'slideOutType', count: number, relayout: 'none' | 'voice'): Generator =>
  (score, rand) => {
    const p = pickBeat(score, rand)
    if (!p || p.beat.notes.length === 0) return null
    const note = pick(rand, p.beat.notes)
    return new SetNoteEffectCommand(p.at, note.string, key, diffEnum(rand, note[key], count), { relayout })
  }

/** Set a random beat's dynamics to a different value (0–7). */
const genDynamics: Generator = (score, rand) => {
  const p = pickBeat(score, rand)
  if (!p) return null
  return new SetBeatEffectCommand(p.at, 'dynamics', diffEnum(rand, p.beat.dynamics, 8) as model.DynamicValue, { relayout: 'voice' })
}

const GENERATORS: Generator[] = [
  genChangeFret,
  genChangeString,
  genAddNote,
  genDeleteNote,
  genBeatToRest,
  genChangeDuration,
  genInsertBeat,
  genDeleteBeat,
  // Phase 4a effects
  noteFlagGen('isPalmMute', 'voice'),
  noteFlagGen('isGhost', 'none'),
  noteFlagGen('isDead', 'none'),
  noteFlagGen('isLetRing', 'voice'),
  noteFlagGen('isHammerPullOrigin', 'voice'),
  genTie,
  noteEnumGen('vibrato', 3, 'voice'),
  noteEnumGen('slideInType', 3, 'voice'),
  noteEnumGen('slideOutType', 7, 'voice'),
  genDynamics,
]

function runRoundTrip(seed: number, steps: number) {
  const score = makeMinimalScore({ bars: 4, beatsPerBar: 3, strings: 6 })
  const original = scoreSnapshot(score)
  const rand = rng(seed)
  const applied: Command[] = []
  let mutations = 0

  for (let i = 0; i < steps; i++) {
    const cmd = pick(rand, GENERATORS)(score, rand)
    if (!cmd) continue
    const before = scoreSnapshot(score)
    cmd.apply(score)
    applied.push(cmd)
    if (JSON.stringify(scoreSnapshot(score)) !== JSON.stringify(before)) mutations++
  }

  const afterApply = scoreSnapshot(score)
  for (let i = applied.length - 1; i >= 0; i--) applied[i].undo(score)

  return { score, original, afterApply, applied, mutations, count: applied.length }
}

describe('round-trip property: apply-all then undo-all == original', () => {
  const seeds = [1, 7, 42, 1337, 99999]

  for (const seed of seeds) {
    it(`seed ${seed}: snapshot restored after undo-all`, () => {
      const { score, original } = runRoundTrip(seed, 60)
      expect(scoreSnapshot(score)).toEqual(original)
    })

    it(`seed ${seed}: redo-all reproduces the applied state, then undo-all restores original`, () => {
      // After undo-all the score is back to `original`. Replaying every command forward (redo) must
      // reproduce the post-apply snapshot, and a second undo-all must return to original. This is the
      // invariant that the AddNote redo bug violated: redo re-applies through `apply()`, which for a
      // cached-object command must re-insert, not just touch a detached note.
      const { score, original, afterApply, applied } = runRoundTrip(seed, 60)
      expect(scoreSnapshot(score)).toEqual(original)

      for (const cmd of applied) cmd.apply(score) // redo-all, in original order
      expect(scoreSnapshot(score)).toEqual(afterApply)

      for (let i = applied.length - 1; i >= 0; i--) applied[i].undo(score)
      expect(scoreSnapshot(score)).toEqual(original)
    })
  }

  it('tripwire: a meaningful fraction of commands actually mutate the score', () => {
    // Every generator that returns a non-null command also changes the snapshot (a ChangeFret
    // landing on its own value is the only near-impossible exception). A low count or ratio would
    // mean refs are resolving to dead beats and apply/undo are no-opping symmetrically — the
    // silent-under-coverage failure the interleaved design exists to prevent.
    const { mutations, count } = runRoundTrip(42, 60)
    expect(count).toBeGreaterThan(30) // most of 60 steps find a valid target; near-0 = frozen refs
    expect(mutations).toBeGreaterThan(count * 0.9) // a non-null command almost always mutates
  })
})
