import type { model } from '@coderline/alphatab'
import { store } from './store'

export type BeatRef = {
  trackIndex: number
  staffIndex: number
  voiceIndex: number
  barIndex: number
  beatIndex: number
}

/**
 * A contiguous beat range within ONE track/staff/voice (Phase 5b copy/cut/paste). `from`/`to` are
 * inclusive and ascending (`from` ≤ `to` by (barIndex, beatIndex)). Built from the store's
 * `anchor` + `selection` by {@link normalizeRange}; consumed by the clipboard commands.
 */
export type BeatRange = {
  trackIndex: number
  staffIndex: number
  voiceIndex: number
  fromBar: number
  fromBeat: number
  toBar: number
  toBeat: number
}

export function selectByBeat(beat: model.Beat): void {
  const ref = beatRefFromBeat(beat)
  if (!ref) return
  // A plain click collapses any active range back to a single-beat selection (clears the anchor).
  store.setState({ selection: ref, anchor: null })
}

/**
 * Shift+click: set the range FOCUS to the clicked beat, seeding `anchor` from the current selection
 * if no range is active yet. Bails if the click lands in a different track/staff/voice than the
 * existing selection — a range is single-track only (PHASE_5 §range selection model). Falls back to
 * a plain select when there's no current selection to anchor against.
 */
export function setRangeFocusByBeat(beat: model.Beat): void {
  const ref = beatRefFromBeat(beat)
  if (!ref) return
  const { selection, anchor } = store.getState()
  if (!selection) {
    store.setState({ selection: ref, anchor: null })
    return
  }
  if (!sameVoice(selection, ref)) return // can't range across tracks/staves/voices
  store.setState({ selection: ref, anchor: anchor ?? selection })
}

/**
 * Select the beat a clicked note belongs to AND set `selectedString` to that note's string, so a
 * follow-up fret edit lands exactly where the user clicked. `beatMouseDown` only carries the beat
 * (no string), which is why clicking used to leave the target string at whatever the arrows last
 * left it — making fret entry feel like it hit a random string.
 */
export function selectByNote(note: model.Note): void {
  const ref = beatRefFromBeat(note.beat)
  if (!ref) return
  // Plain click on a note head → collapse any range too (clears anchor).
  store.setState({ selection: ref, anchor: null, selectedString: note.string })
}

export function clearSelection(): void {
  store.setState({ selection: null, anchor: null })
}

/** Drop any active range, keeping the single-beat focus. Called by every plain (non-shift) nav. */
export function clearAnchor(): void {
  if (store.getState().anchor !== null) store.setState({ anchor: null })
}

export function moveBeat(dx: -1 | 1): void {
  const state = store.getState()
  const sel = state.selection
  const api = state.api
  if (!sel || !api || !api.score) return

  const voice = resolveVoice(api.score, sel)
  if (!voice) return

  const beats = voice.beats.length
  let next = sel.beatIndex + dx
  let nextBar = sel.barIndex
  if (next < 0) {
    nextBar = sel.barIndex - 1
    if (nextBar < 0) return
    const prevVoice = resolveVoice(api.score, { ...sel, barIndex: nextBar })
    if (!prevVoice || prevVoice.beats.length === 0) return
    next = prevVoice.beats.length - 1
  } else if (next >= beats) {
    const staff = api.score.tracks[sel.trackIndex]?.staves[sel.staffIndex]
    if (!staff || nextBar + 1 >= staff.bars.length) return
    nextBar = sel.barIndex + 1
    const nextVoice = resolveVoice(api.score, { ...sel, barIndex: nextBar })
    if (!nextVoice || nextVoice.beats.length === 0) return
    next = 0
  }
  store.setState({ selection: { ...sel, barIndex: nextBar, beatIndex: next } })
}

export function moveString(dy: -1 | 1): void {
  const state = store.getState()
  const sel = state.selection
  const api = state.api
  if (!sel || !api || !api.score) return

  const staff = api.score.tracks[sel.trackIndex]?.staves[sel.staffIndex]
  if (!staff) return
  const count = staff.tuning.length
  if (count === 0) return

  // dy = -1 (arrow up) → visually up → higher string index. dy = +1 (arrow down) → lower.
  const delta = -dy
  const next = Math.max(1, Math.min(count, state.selectedString + delta))
  if (next === state.selectedString) return
  store.setState({ selectedString: next })
}

/**
 * Shift+arrow: extend the range by one beat. Seeds `anchor` from the current focus on first
 * extension, then moves the focus with {@link moveBeat} (which stays within the track and leaves
 * `anchor` untouched). A boundary refusal leaves a zero-length range — harmless.
 */
export function extendSelection(dx: -1 | 1): void {
  const { selection, anchor } = store.getState()
  if (!selection) return
  if (anchor === null) store.setState({ anchor: selection })
  moveBeat(dx)
}

/**
 * Re-validate the stored selection after a structural edit (insert/delete) AND its undo/redo —
 * the Phase-2-deferred `BeatRef` re-resolver (Risk 5). `BeatRef` is index-based and stable under
 * value edits, but insert/delete shift indices, so a stored `beatIndex` may now point past the end
 * (or at a different beat). Clamp it to a beat that still exists: same `beatIndex` if valid, else
 * the bar's last beat; if the bar emptied, walk back to the previous non-empty bar. `selectedString`
 * clamps to the tuning range. A value edit never invalidates a BeatRef, so this is a harmless no-op
 * there — safe to call on every mutation. Pure clamp against the live score; no command needed.
 */
export function reValidateSelection(score: model.Score): void {
  const { selection, selectedString } = store.getState()
  if (!selection) return

  let nextRef = selection
  const voice = resolveVoice(score, selection)
  if (!voice || voice.beats.length === 0) {
    // Bar emptied (shouldn't happen — delete-last collapses to a rest — but stay defensive):
    // walk back to the previous bar that has beats.
    const staff = score.tracks[selection.trackIndex]?.staves[selection.staffIndex]
    let barIndex = selection.barIndex - 1
    let landed: BeatRef | null = null
    while (staff && barIndex >= 0) {
      const v = staff.bars[barIndex]?.voices[selection.voiceIndex]
      if (v && v.beats.length > 0) {
        landed = { ...selection, barIndex, beatIndex: v.beats.length - 1 }
        break
      }
      barIndex--
    }
    if (landed) nextRef = landed
  } else if (selection.beatIndex >= voice.beats.length) {
    nextRef = { ...selection, beatIndex: voice.beats.length - 1 }
  }

  const staff = score.tracks[nextRef.trackIndex]?.staves[nextRef.staffIndex]
  const count = staff?.tuning.length ?? selectedString
  const nextString = Math.max(1, Math.min(count, selectedString))

  if (nextRef !== selection || nextString !== selectedString) {
    store.setState({ selection: nextRef, selectedString: nextString })
  }
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

/**
 * Display label for a fretboard string — the 1-based string number plus its open-string note name
 * (e.g. `1 · E`). Used by the empty-beat cue, where there's no fret digit to highlight and the user
 * needs to know which string a fret will land on; the number keeps the two same-named guitar E
 * strings (1 and 6) distinct.
 *
 * `selectedString` follows {@link moveString}'s convention: 1 = lowest string (bottom tab line),
 * increasing upward. `tuning` is ordered top-line-first (index 0 = highest string), so the two are
 * INVERTED — the tuning index is `length - selectedString`, not `selectedString - 1`. Falls back to
 * the bare number if the string is out of the tuning's range.
 */
export function openStringLabel(tuning: number[], selectedString: number): string {
  const midi = tuning[tuning.length - selectedString]
  if (midi == null || !Number.isFinite(midi)) return `${selectedString}`
  return `${selectedString} · ${NOTE_NAMES[((midi % 12) + 12) % 12]}`
}

function beatRefFromBeat(beat: model.Beat): BeatRef | null {
  const voice = beat.voice
  const bar = voice.bar
  const staff = bar.staff
  const track = staff.track
  // v1: collapse voice-1 clicks to voice-0 at the same beat index when possible.
  if (voice.index !== 0) {
    const v0 = bar.voices[0]
    if (!v0 || beat.index >= v0.beats.length) return null
    return {
      trackIndex: track.index,
      staffIndex: staff.index,
      voiceIndex: 0,
      barIndex: bar.index,
      beatIndex: beat.index,
    }
  }
  return {
    trackIndex: track.index,
    staffIndex: staff.index,
    voiceIndex: 0,
    barIndex: bar.index,
    beatIndex: beat.index,
  }
}

export function resolveBeat(score: model.Score, at: BeatRef): model.Beat | null {
  return resolveVoice(score, at)?.beats[at.beatIndex] ?? null
}

export function resolveVoice(score: model.Score, at: BeatRef): model.Voice | null {
  const track = score.tracks[at.trackIndex]
  if (!track) return null
  const staff = track.staves[at.staffIndex]
  if (!staff) return null
  const bar = staff.bars[at.barIndex]
  if (!bar) return null
  return bar.voices[at.voiceIndex] ?? null
}

/** True if two refs address the same track/staff/voice (range membership precondition). */
export function sameVoice(a: BeatRef, b: BeatRef): boolean {
  return (
    a.trackIndex === b.trackIndex &&
    a.staffIndex === b.staffIndex &&
    a.voiceIndex === b.voiceIndex
  )
}

/** Order two refs in the same voice into an ascending {@link BeatRange}, or null if they're not in
 *  the same voice. (barIndex, beatIndex) is the sort key. */
export function normalizeRange(a: BeatRef, b: BeatRef): BeatRange | null {
  if (!sameVoice(a, b)) return null
  const aFirst = a.barIndex < b.barIndex || (a.barIndex === b.barIndex && a.beatIndex <= b.beatIndex)
  const lo = aFirst ? a : b
  const hi = aFirst ? b : a
  return {
    trackIndex: a.trackIndex,
    staffIndex: a.staffIndex,
    voiceIndex: a.voiceIndex,
    fromBar: lo.barIndex,
    fromBeat: lo.beatIndex,
    toBar: hi.barIndex,
    toBeat: hi.beatIndex,
  }
}

/**
 * The range the clipboard acts on: the normalized `[anchor, selection]` when a range is active, else
 * the single-beat `selection` collapsed to a zero-length range (so copy/cut/paste all work on one
 * beat with no range — consistent with the `i`-insert fallback). Null when nothing is selected.
 */
export function activeRange(): BeatRange | null {
  const { selection, anchor } = store.getState()
  if (!selection) return null
  return normalizeRange(anchor ?? selection, selection)
}

/** Collect the beats of `range` from `score` IN ORDER, walking across bars. Used by copy/paste to
 *  gather the source beats (live score for copy bytes; the GP7 clone for the actual paste beats). */
export function collectRangeBeats(score: model.Score, range: BeatRange): model.Beat[] {
  const staff = score.tracks[range.trackIndex]?.staves[range.staffIndex]
  if (!staff) return []
  const out: model.Beat[] = []
  for (let b = range.fromBar; b <= range.toBar; b++) {
    const voice = staff.bars[b]?.voices[range.voiceIndex]
    if (!voice) continue
    const start = b === range.fromBar ? range.fromBeat : 0
    const end = b === range.toBar ? Math.min(range.toBeat, voice.beats.length - 1) : voice.beats.length - 1
    for (let i = start; i <= end; i++) {
      const beat = voice.beats[i]
      if (beat) out.push(beat)
    }
  }
  return out
}
