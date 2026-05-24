import { store } from './store'

export function setTrackRendered(index: number, rendered: boolean): void {
  const state = store.getState()
  const next = state.tracks.map((t) => (t.index === index ? { ...t, rendered } : t))
  if (!next.some((t) => t.rendered)) return
  store.setState({ tracks: next })
  const api = state.api
  if (!api || !api.score) return
  const renderTargets = next.filter((t) => t.rendered).map((t) => api.score!.tracks[t.index])
  api.renderTracks(renderTargets)
}

export function setTrackMuted(index: number, muted: boolean): void {
  const state = store.getState()
  const next = state.tracks.map((t) => (t.index === index ? { ...t, muted } : t))
  store.setState({ tracks: next })
  const api = state.api
  if (!api || !api.score) return
  api.changeTrackMute([api.score.tracks[index]], muted)
}

export function setTrackSoloed(index: number, soloed: boolean): void {
  const state = store.getState()
  const next = state.tracks.map((t) => (t.index === index ? { ...t, soloed } : t))
  store.setState({ tracks: next })
  const api = state.api
  if (!api || !api.score) return
  api.changeTrackSolo([api.score.tracks[index]], soloed)
}
