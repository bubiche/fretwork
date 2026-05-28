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

function resolveVoice(score: model.Score, at: BeatRef): model.Voice | null {
  const track = score.tracks[at.trackIndex]
  if (!track) return null
  const staff = track.staves[at.staffIndex]
  if (!staff) return null
  const bar = staff.bars[at.barIndex]
  if (!bar) return null
  return bar.voices[at.voiceIndex] ?? null
}
