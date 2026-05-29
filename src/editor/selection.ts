import type { model } from '@coderline/alphatab'
import { store } from './store'

export type BeatRef = {
  trackIndex: number
  staffIndex: number
  voiceIndex: number
  barIndex: number
  beatIndex: number
}

export function selectByBeat(beat: model.Beat): void {
  const ref = beatRefFromBeat(beat)
  if (!ref) return
  store.setState({ selection: ref })
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
  store.setState({ selection: ref, selectedString: note.string })
}

export function clearSelection(): void {
  store.setState({ selection: null })
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
