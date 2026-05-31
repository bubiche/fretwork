import { exporter, importer, model } from '@coderline/alphatab'
import { store } from '../../store'
import {
  activeRange,
  collectRangeBeats,
  reValidateSelection,
  type BeatRange,
  type BeatRef,
} from '../../selection'
import { execute } from '../../HistoryRouter'
import { CompositeCommand } from '../Composite'
import { PasteCommand } from './Paste'
import { DeleteRangeCommand } from './DeleteRange'
import { severLinks } from './linkSurgery'

/**
 * Phase 5b copy/cut/paste. The clipboard is module-level (non-serializable, like the undo stack) and
 * holds a **full-fidelity GP7 binary snapshot of the whole score** plus the copied range — NOT a
 * hand-rolled beat serializer. Rationale (verified during planning, see implementation notes):
 *   - `JsonConverter` type-checks but is absent from the runtime bundle (throws) — unusable.
 *   - A snapshot-field serializer would silently drop any effect the snapshot doesn't enumerate (the
 *     Phase 4 chord-GC failure mode); the round-trip test shares that field set, so both would agree
 *     while dropping bends/whammy/harmonics.
 *   - The GP7 binary round-trip (`Gp7Exporter` → `ScoreLoader`) is exported, lossless for bends, and
 *     stable for whammy (a one-time benign duplicate point — same curve). It's also the Phase 6
 *     export path, so building paste on it de-risks Phase 6.
 * Serializing the whole score per copy is heavier than a fragment but fully faithful, and fine for a
 * single-user tool. Re-parsing the bytes on every paste yields fresh, independent beat objects, so
 * repeated ⌘V just works.
 */
type Clipboard = { scoreBytes: Uint8Array; range: BeatRange }
let clipboard: Clipboard | null = null

/** Whether there's anything to paste (the keyboard/UI may gate ⌘V on this). */
export function hasClipboard(): boolean {
  return clipboard !== null
}

/** Test seam: reset the module-level clipboard between tests. */
export function clearClipboard(): void {
  clipboard = null
}

/** ⌘C — snapshot the score + the active range into the clipboard. Does NOT clear the range (so a
 *  copy can be followed by repeated pastes). No-op when there's no selection/range or no score. */
export function copySelection(): void {
  const { api } = store.getState()
  const range = activeRange()
  if (!api?.score || !api.settings || !range) return
  clipboard = { scoreBytes: new exporter.Gp7Exporter().export(api.score, api.settings), range }
}

/**
 * ⌘X — copy, then delete the range as one undo step. The clipboard write lives HERE in the dispatcher
 * (never inside a command's `apply`) so a redo of the delete can't re-fire it and clobber whatever the
 * user copied since the cut (PHASE_5 §cut). Selection collapses to the deletion point.
 */
export function cutSelection(): void {
  const { api } = store.getState()
  const range = activeRange()
  if (!api?.score || !api.settings || !range) return
  clipboard = { scoreBytes: new exporter.Gp7Exporter().export(api.score, api.settings), range }
  execute(new DeleteRangeCommand(range))
  // Land on the deletion point (range start); drop the range. reValidateSelection clamps beatIndex
  // when the range reached the end of the voice (the deleted block had no successor).
  store.setState({
    selection: {
      trackIndex: range.trackIndex,
      staffIndex: range.staffIndex,
      voiceIndex: range.voiceIndex,
      barIndex: range.fromBar,
      beatIndex: range.fromBeat,
    },
    anchor: null,
  })
  if (api.score) reValidateSelection(api.score)
}

/**
 * ⌘V — re-parse the clipboard bytes into a fresh score, lift the copied range's beats (now independent
 * objects), and place them at the target (PHASE_5 §paste target). The placement follows the text-editor
 * model the owner chose (hybrid):
 *   - **Caret** (single-beat selection / no real range): INSERT after the selected beat, shifting the
 *     rest right. Nothing is overwritten.
 *   - **Range** (a genuine multi-beat Shift-selection): REPLACE the range — paste, then delete the
 *     selected span, as ONE undo step (`CompositeCommand`). `A [B C] D` + paste(X Y) → `A X Y D`.
 *
 * Order is paste-THEN-delete so the range's HIGH-end bar keeps the freshly pasted beats: `DeleteRange`
 * only synthesizes a quarter rest for a bar it FULLY empties, so this avoids a stray rest in the common
 * within-bar/whole-bar case. (Multi-bar replace still collapses earlier fully-covered bars to rests —
 * the no-auto-rebar limitation — and lands the run in the high-end bar.)
 *
 * Either way the selection collapses to a CARET at the last pasted beat (not a span). Leaving the run
 * selected would make the next ⌘V see a range and replace the riff with itself; a trailing caret means
 * a repeated ⌘V inserts-after and chains the riff — and matches where a text editor leaves the cursor
 * after a paste. Carried chord diagrams are registered into the target staff so `chordId` resolves.
 */
export function pasteClipboard(): void {
  const { api, selection, anchor } = store.getState()
  const range = activeRange() // ascending; falls back to the single-beat selection when no anchor
  if (!api?.score || !api.settings || !clipboard || !selection || !range) return

  const clone = importer.ScoreLoader.loadScoreFromBytes(clipboard.scoreBytes, api.settings)
  clone.finish(api.settings)
  const srcBeats = collectRangeBeats(clone, clipboard.range)
  if (srcBeats.length === 0) return
  prepareClonedBeats(api.score, srcBeats) // make the lifted beats safe to splice + render (see below)

  // Carry the Chord objects the pasted beats reference, from the clone's SOURCE staff (where copy
  // captured them) — PasteCommand re-registers them into the target staff so chordId resolves.
  const srcStaff = clone.tracks[clipboard.range.trackIndex]?.staves[clipboard.range.staffIndex]
  const carriedChords = new Map<string, model.Chord>()
  for (const beat of srcBeats) {
    const id = beat.chordId
    if (id && srcStaff?.chords?.has(id)) carriedChords.set(id, srcStaff.chords.get(id)!)
  }

  // A genuine multi-beat range (anchor set AND spanning more than one beat) is REPLACED; a single beat,
  // or a zero-length anchored range (Shift+click the same beat / boundary refusal), is a caret.
  const isRange =
    anchor !== null && !(range.fromBar === range.toBar && range.fromBeat === range.toBeat)

  // Insert AFTER the range's high end either way (for a caret, high end == the selected beat).
  const at: BeatRef = {
    trackIndex: range.trackIndex,
    staffIndex: range.staffIndex,
    voiceIndex: range.voiceIndex,
    barIndex: range.toBar,
    beatIndex: range.toBeat,
  }
  const paste = new PasteCommand(at, srcBeats, carriedChords)

  // The last pasted beat's resting index. Caret: pasted lands at [toBeat+1 .. toBeat+count]. Replace:
  // the delete removes the originals before the run, so it shifts down to start at fromBeat (single
  // bar) or 0 (multi-bar) of the high-end bar.
  let caretBeatIndex: number
  if (isRange) {
    execute(new CompositeCommand([paste, new DeleteRangeCommand(range)], `Replace range with ${srcBeats.length} beat(s)`))
    const start = range.fromBar === range.toBar ? range.fromBeat : 0
    caretBeatIndex = start + srcBeats.length - 1
  } else {
    execute(paste)
    caretBeatIndex = at.beatIndex + srcBeats.length
  }

  store.setState({
    selection: { ...at, beatIndex: caretBeatIndex },
    anchor: null,
  })
  reValidateSelection(api.score)
}

/**
 * Make freshly-lifted clone beats safe to splice into `target` and survive the render WORKER's JSON
 * round-trip. alphaTab serializes the whole score to its render worker, which re-links notes BY ID
 * (`Note.chain`, reached via `JsonConverter.jsObjectToScore`). Two hazards, both because the beats
 * come from a separately re-parsed score:
 *
 *   1. **Cross-boundary links.** A note tied/slurred/hammered/slid to a partner that wasn't copied
 *      keeps an object pointer into the clone score. Main-thread `finish()` does NOT clear it — its
 *      `chain` early-returns for a pure origin, and for a destination short-circuits on the non-null
 *      stale `tieOrigin` — so `Note.toJson` emits a link id with no matching note in the payload. In
 *      the worker `noteIdLookup.get(id)` is then `undefined` → `undefined.tieDestination = this`
 *      throws (`Cannot set properties of undefined`). Sever any link whose partner isn't in the
 *      pasted set; intra-fragment links (both ends copied) are kept, so a copied riff keeps its own
 *      ties/hammer-ons/slides.
 *   2. **Colliding ids.** Every import resets alphaTab's global id counter (`ScoreImporter.init` →
 *      `Score.resetIds`), so the clone's notes/beats reuse ids the target already has. The worker's
 *      id-keyed lookups — notes for relinking, `BoundsLookup` for beats (keyed by `beat.id`) — then
 *      collide, mislinking ties or misplacing the beat bounds the selection overlay reads. Reassign
 *      every pasted note AND beat an id above the target's current max. (Bars/voices need none: paste
 *      splices into existing target bars and introduces no new bar/voice objects.)
 *
 * Mirrors alphaTab's own copy discipline, which re-ids on clone (`cloneNote.id = Note.globalNoteId++`).
 * Runs once per paste in the dispatcher on the fresh clone beats, so `PasteCommand` stays a pure splice.
 */
export function prepareClonedBeats(target: model.Score, beats: model.Beat[]): void {
  const inSet = new Set<model.Note>()
  for (const beat of beats) for (const note of beat.notes) inSet.add(note)

  // Sever every link crossing OUT of the pasted set (intra-fragment links are kept, so a copied riff
  // keeps its own ties/HOPOs/slides). Shared taxonomy with the delete/cut side — see `linkSurgery`. No
  // revert is kept: these are fresh clone notes, discarded if the paste is undone.
  const allPasted: model.Note[] = []
  for (const beat of beats) for (const note of beat.notes) allPasted.push(note)
  severLinks(allPasted, (partner) => !inSet.has(partner))

  let maxNoteId = 0
  let maxBeatId = 0
  for (const track of target.tracks)
    for (const staff of track.staves)
      for (const bar of staff.bars)
        for (const voice of bar.voices)
          for (const b of voice.beats) {
            if (b.id > maxBeatId) maxBeatId = b.id
            for (const n of b.notes) if (n.id > maxNoteId) maxNoteId = n.id
          }
  let nextNote = maxNoteId + 1
  let nextBeat = maxBeatId + 1
  for (const beat of beats) {
    beat.id = nextBeat++
    for (const note of beat.notes) note.id = nextNote++
  }

  // Advance alphaTab's global id counters past the ids we just handed out. The clone re-parse reset
  // them low (`ScoreImporter.init` → `Score.resetIds`), so without this the NEXT note/beat created —
  // a later AddNote/InsertBeat — would be allocated a now-in-use pasted id and collide in the worker
  // relink all over again (this time intermittently, only when both ends become link partners).
  // `globalNoteId`/`_globalBeatId` are @internal statics, absent from the typings — cast to reach them.
  const noteIds = model.Note as unknown as { globalNoteId: number }
  const beatIds = model.Beat as unknown as { _globalBeatId: number }
  noteIds.globalNoteId = Math.max(noteIds.globalNoteId, nextNote)
  beatIds._globalBeatId = Math.max(beatIds._globalBeatId, nextBeat)
}
