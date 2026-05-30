import { model } from '@coderline/alphatab'
import { resolveBeat, resolveVoice, type BeatRef } from './selection'

/**
 * Settable scalar note effect fields the editor writes (Phase 4). Boolean flags and enum values
 * only — never derived `Note`-reference pointers (`hammerPullDestination`, `slideTarget`, …),
 * which `finish()` owns. The 4a slice; 4b adds `harmonicType`/`harmonicValue`/`bendType`.
 */
export type NoteEffectField =
  | 'isPalmMute'
  | 'isGhost'
  | 'isDead'
  | 'isLetRing'
  | 'isHammerPullOrigin'
  | 'isTieDestination'
  | 'vibrato'
  | 'slideInType'
  | 'slideOutType'

/** Settable scalar beat effect fields (Phase 4). 4a: `dynamics`. 4b extends with whammy/tap/etc. */
export type BeatEffectField = 'dynamics'

/**
 * The single resolution point between an opaque `BeatRef` + string number and a live
 * alphaTab `Note`. Shared by Commands and tests so there's one implementation.
 *
 * `stringIndex` is 1-based (string 1 = lowest/bottom tab line), matching alphaTab's
 * `Note.string`. Returns `null` if the beat doesn't exist or carries no note on that string
 * (e.g. a rest, or a string that isn't fretted on this beat).
 */
export function resolveNote(
  score: model.Score,
  at: BeatRef,
  stringIndex: number,
): model.Note | null {
  const beat = resolveBeat(score, at)
  if (!beat) return null
  return beat.notes.find((n) => n.string === stringIndex) ?? null
}

/**
 * Thin ergonomic wrapper over alphaTab's Score model. Phase 2 ships only `changeFret`;
 * Phase 3 grows the rest (`addNote`, `deleteNote`, `changeDuration`, …). Commands construct
 * a short-lived mutator over the score they're handed in `apply`/`undo`.
 */
export class ScoreMutator {
  private score: model.Score

  constructor(score: model.Score) {
    this.score = score
  }

  changeFret(at: BeatRef, stringIndex: number, fret: number): void {
    const note = resolveNote(this.score, at, stringIndex)
    if (note) note.fret = fret
  }

  /**
   * Write a single settable effect field on the note at `at`/`stringIndex` (Phase 4). Dumb by
   * design: resolve, write, return — the Command owns capture-once/undo. Typed so `key` and
   * `value` agree (a `vibrato` write only accepts a `VibratoType`). No-op if the string is empty.
   */
  setNoteField<K extends NoteEffectField>(
    at: BeatRef,
    stringIndex: number,
    key: K,
    value: model.Note[K],
  ): void {
    const note = resolveNote(this.score, at, stringIndex)
    if (note) note[key] = value
  }

  /** Write a single settable effect field on the beat at `at` (Phase 4). Same contract as
   *  `setNoteField` but beat-level (dynamics in 4a; whammy/tap/grace/chord/tremolo in 4b). */
  setBeatField<K extends BeatEffectField>(at: BeatRef, key: K, value: model.Beat[K]): void {
    const beat = resolveBeat(this.score, at)
    if (beat) beat[key] = value
  }

  /**
   * Move the note from `fromString` to `toString` in place, keeping `noteStringLookup` consistent
   * (`delete` old key, `set` new). No-op (returns false) if there's no note on `fromString` or the
   * target string is already occupied — `Beat.getNoteOnString` reads the lookup, so leaving it
   * stale would make the renderer and future resolves lie. Range is the caller's responsibility.
   */
  changeString(at: BeatRef, fromString: number, toString: number): boolean {
    const beat = resolveBeat(this.score, at)
    if (!beat) return false
    const note = beat.getNoteOnString(fromString)
    if (!note) return false
    if (beat.getNoteOnString(toString)) return false // occupied
    beat.noteStringLookup.delete(note.string)
    note.string = toString
    beat.noteStringLookup.set(toString, note)
    return true
  }

  /**
   * Construct and add a note on an empty string (chord build). Returns the new note, or null if
   * the beat doesn't exist or the string is already occupied (AddNote never overwrites — the
   * dispatcher routes an occupied-string keystroke to ChangeFret instead).
   */
  addNote(at: BeatRef, stringIndex: number, fret: number): model.Note | null {
    const beat = resolveBeat(this.score, at)
    if (!beat) return null
    if (beat.getNoteOnString(stringIndex)) return null
    const note = new model.Note()
    note.string = stringIndex
    note.fret = fret
    beat.addNote(note)
    return note
  }

  /** Re-add an existing Note object (undo of delete / beat-to-rest). Preserves the object so any
   *  effects ride along for free; `addNote` appends and the snapshot sorts by string. */
  restoreNote(at: BeatRef, note: model.Note): void {
    resolveBeat(this.score, at)?.addNote(note)
  }

  /** Remove a specific Note object from the beat at `at`. */
  removeNote(at: BeatRef, note: model.Note): void {
    resolveBeat(this.score, at)?.removeNote(note)
  }

  /** Remove every note from the beat (→ rest) and return them for undo. */
  clearBeat(at: BeatRef): model.Note[] {
    const beat = resolveBeat(this.score, at)
    if (!beat) return []
    const removed = [...beat.notes]
    for (const note of removed) beat.removeNote(note)
    return removed
  }

  /** Set the beat's duration enum value and dot count. The renderer needs a finish() relayout
   *  after this (beaming/tick reflow); the model field write itself is direct. */
  changeDuration(at: BeatRef, duration: model.Duration, dots: number): void {
    const beat = resolveBeat(this.score, at)
    if (!beat) return
    beat.duration = duration
    beat.dots = dots
  }

  /**
   * Insert a fresh empty beat (quarter rest) immediately AFTER `at` and return it. Array-position
   * splice — NOT `Voice.insertBeat`, whose `after.index + 1` goes stale finish-free (would misplace
   * a second insert in the property test). `beat.voice` is set because `Beat.finish` derefs it;
   * indices/chain are fixed by the caller's finish() relayout.
   */
  insertBeatAfter(at: BeatRef): model.Beat | null {
    const voice = resolveVoice(this.score, at)
    if (!voice) return null
    const beat = new model.Beat()
    beat.voice = voice // Beat.finish reads this.voice.index; splice won't set it (Voice.finish won't either)
    voice.beats.splice(at.beatIndex + 1, 0, beat)
    return beat
  }

  /** Remove the beat at `at` by array position and return it (kept for undo re-insertion).
   *  Array splice handles index 0 with no special case, unlike `Voice.insertBeat`. */
  removeBeat(at: BeatRef): model.Beat | null {
    const voice = resolveVoice(this.score, at)
    if (!voice) return null
    const beat = voice.beats[at.beatIndex]
    if (!beat) return null
    // Hand the removed beat's back-pointer to its successor. finish() rebuilds the FORWARD chain
    // (nextBeat) but only sets previousBeat via forward links — it never resets the first beat's
    // previousBeat. So deleting the front beat would otherwise leave the new head pointing at the
    // removed beat. This one line keeps the boundary honest; finish() repairs everything else.
    if (beat.nextBeat) beat.nextBeat.previousBeat = beat.previousBeat
    voice.beats.splice(at.beatIndex, 1)
    return beat
  }

  /** Re-insert a previously removed beat object at `index` (undo of removeBeat). Re-sets `voice`
   *  in case it was cleared, and `splice` covers index 0. */
  reinsertBeat(at: BeatRef, index: number, beat: model.Beat): void {
    const voice = resolveVoice(this.score, at)
    if (!voice) return
    beat.voice = voice
    voice.beats.splice(index, 0, beat)
  }
}
