import type { model } from '@coderline/alphatab'
import type { Command } from '../../CommandStack'
import type { BeatRef } from '../../selection'
import { resolveBeat } from '../../selection'
import {
  ScoreMutator,
  resolveNote,
  type NoteEffectField,
  type BeatEffectField,
} from '../../ScoreMutator'

/**
 * Generic "set one settable effect field" command — the shape every basic effect shares.
 *
 * A key finding is load-bearing here: each effect (incl. the linked ones — HO/PO,
 * let-ring, slide, tie) is a **single-field write on one resolved note**; `finish()` derives all
 * the cross-note wiring. So one parameterized command covers palm mute, ghost, dead, vibrato,
 * let-ring, HO/PO, slide, and tie — they differ only in `key`, `value`, `relayout`, and label.
 * Writing nine identical capture/undo classes would just duplicate this (and the project's
 * simplicity rule says don't). Per-effect *dispatchers* live in `articulation.ts` / `linked.ts`;
 * each gets its own generator in the round-trip property test, so coverage is per-effect.
 *
 * CAPTURE-ONCE with `=== null` (never `if (!prior)`): every 4a field is a boolean or an enum
 * whose "off" is `false`/`0` — both falsy, both legal. `prior` is only ever `null` before the
 * first apply because the field's own type never includes `null` (the same trap `ChangeFret`
 * spells out). 4b's nullable `bendPoints` will need a separate captured-flag — out of scope here.
 */
export class SetNoteEffectCommand<K extends NoteEffectField> implements Command {
  readonly relayout: 'none' | 'voice'
  private prior: model.Note[K] | null = null
  private at: BeatRef
  private stringIndex: number
  private key: K
  private value: model.Note[K]
  private label: string

  constructor(
    at: BeatRef,
    stringIndex: number,
    key: K,
    value: model.Note[K],
    opts: { relayout?: 'none' | 'voice'; label?: string } = {},
  ) {
    this.at = at
    this.stringIndex = stringIndex
    this.key = key
    this.value = value
    this.relayout = opts.relayout ?? 'none'
    this.label = opts.label ?? String(key)
  }

  apply(score: model.Score): void {
    const note = resolveNote(score, this.at, this.stringIndex)
    if (!note) return
    if (this.prior === null) this.prior = note[this.key]
    new ScoreMutator(score).setNoteField(this.at, this.stringIndex, this.key, this.value)
  }

  undo(score: model.Score): void {
    if (this.prior === null) return
    new ScoreMutator(score).setNoteField(this.at, this.stringIndex, this.key, this.prior)
  }

  describe(): string {
    return `${this.label} on beat ${this.at.beatIndex}`
  }
}

/** Beat-level twin of {@link SetNoteEffectCommand}. 4a uses it only for dynamics. */
export class SetBeatEffectCommand<K extends BeatEffectField> implements Command {
  readonly relayout: 'none' | 'voice'
  private prior: model.Beat[K] | null = null
  private at: BeatRef
  private key: K
  private value: model.Beat[K]
  private label: string

  constructor(
    at: BeatRef,
    key: K,
    value: model.Beat[K],
    opts: { relayout?: 'none' | 'voice'; label?: string } = {},
  ) {
    this.at = at
    this.key = key
    this.value = value
    this.relayout = opts.relayout ?? 'none'
    this.label = opts.label ?? String(key)
  }

  apply(score: model.Score): void {
    const beat = resolveBeat(score, this.at)
    if (!beat) return
    if (this.prior === null) this.prior = beat[this.key]
    new ScoreMutator(score).setBeatField(this.at, this.key, this.value)
  }

  undo(score: model.Score): void {
    if (this.prior === null) return
    new ScoreMutator(score).setBeatField(this.at, this.key, this.prior)
  }

  describe(): string {
    return `${this.label} on beat ${this.at.beatIndex}`
  }
}
