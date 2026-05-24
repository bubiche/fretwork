import { useEffect, useRef } from 'preact/hooks'
import type { AlphaTabApi, model } from '@coderline/alphatab'
import { createAlphaTab } from '../alphatab/api'
import { store, DEFAULT_TRANSPORT } from '../editor/store'
import { useStore } from './hooks/useStore'
import { getFileBytes } from '../persistence/db'
import { applyTransportToApi } from '../editor/transport'

export function ScoreView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<AlphaTabApi | null>(null)
  const currentFileId = useStore((s) => s.currentFileId)
  const error = useStore((s) => s.error)

  useEffect(() => {
    if (!containerRef.current || !scrollRef.current) return
    const instance = createAlphaTab(containerRef.current, scrollRef.current)
    instance.error.on((e) => {
      console.error('alphaTab error', e)
      store.setState({ error: e.message })
    })
    let lastScore: model.Score | null = null
    instance.scoreLoaded.on((score) => {
      if (score === lastScore) return
      lastScore = score
      store.setState({
        tracks: score.tracks.map((t) => ({
          index: t.index,
          name: t.name,
          rendered: true,
          muted: false,
          soloed: false,
        })),
      })
      applyTransportToApi(instance, store.getState().transport)
    })
    apiRef.current = instance
    store.setState({ api: instance })
    return () => {
      instance.destroy()
      apiRef.current = null
      store.setState({ api: null, transport: DEFAULT_TRANSPORT, tracks: [] })
    }
  }, [])

  useEffect(() => {
    if (!apiRef.current || !currentFileId) return
    let cancelled = false
    getFileBytes(currentFileId).then((bytes) => {
      if (cancelled || !apiRef.current || !bytes) return
      store.setState({ error: null })
      const ok = apiRef.current.load(bytes)
      if (!ok) store.setState({ error: "Couldn't read this file." })
    })
    return () => {
      cancelled = true
    }
  }, [currentFileId])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {error && (
        <div style={{ padding: '0.5rem 1rem', background: '#fee', color: '#900', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}
      <div
        ref={scrollRef}
        style={{ flex: 1, overflow: 'auto', position: 'relative', background: '#fafafa' }}
      >
        <div ref={containerRef} style={{ padding: '1rem' }} />
        {!currentFileId && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#888',
              fontSize: '0.9rem',
              textAlign: 'center',
              pointerEvents: 'none',
              padding: '1rem',
              background: '#fafafa',
            }}
          >
            Drop a Guitar Pro file here, or use the sidebar to add one.
          </div>
        )}
      </div>
    </div>
  )
}
