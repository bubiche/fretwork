import type { AlphaTabApi, model } from '@coderline/alphatab'
import { store, type TransportState } from './store'
import { resolveBeat } from './selection'

export function applyTransportToApi(api: AlphaTabApi, t: TransportState): void {
  api.playbackSpeed = t.playbackSpeed
  api.metronomeVolume = t.metronome ? 1 : 0
  api.countInVolume = t.countIn ? 1 : 0
}

export function setTransport(patch: Partial<TransportState>): void {
  const current = store.getState().transport
  const next: TransportState = { ...current, ...patch }
  store.setState({ transport: next })
  const api = store.getState().api
  if (api) applyTransportToApi(api, next)
}

export function seekToBeat(api: AlphaTabApi, beat: model.Beat): void {
  api.tickPosition = beat.absolutePlaybackStart
}

export function seekToSelection(): void {
  const state = store.getState()
  const api = state.api
  const sel = state.selection
  if (!api || !api.score || !sel) return
  const beat = resolveBeat(api.score, sel)
  if (!beat) return
  seekToBeat(api, beat)
}
