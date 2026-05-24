import type { AlphaTabApi } from '@coderline/alphatab'
import { store, type TransportState } from './store'

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
