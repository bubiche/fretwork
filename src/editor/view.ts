import { LayoutMode } from '@coderline/alphatab'
import { store, type LayoutModeOption } from './store'

const ZOOM_DEBOUNCE_MS = 200
let zoomTimer: ReturnType<typeof setTimeout> | null = null

export function setZoom(zoom: number): void {
  store.setState({ view: { ...store.getState().view, zoom } })
  const api = store.getState().api
  if (!api) return
  if (zoomTimer) clearTimeout(zoomTimer)
  zoomTimer = setTimeout(() => {
    api.settings.display.scale = zoom
    api.updateSettings()
    api.render()
    zoomTimer = null
  }, ZOOM_DEBOUNCE_MS)
}

export function setLayoutMode(mode: LayoutModeOption): void {
  store.setState({ view: { ...store.getState().view, layoutMode: mode } })
  const api = store.getState().api
  if (!api) return
  api.settings.display.layoutMode = mode === 'page' ? LayoutMode.Page : LayoutMode.Horizontal
  api.updateSettings()
  api.render()
}
