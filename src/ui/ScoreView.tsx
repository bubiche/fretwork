import { useEffect, useRef, useState } from 'preact/hooks'
import type { AlphaTabApi } from '@coderline/alphatab'
import { createAlphaTab } from '../alphatab/api'
import { store } from '../editor/store'
import { useStore } from './hooks/useStore'
import { getFileBytes } from '../persistence/db'

export function ScoreView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<AlphaTabApi | null>(null)
  const [api, setApi] = useState<AlphaTabApi | null>(null)
  const currentFileId = useStore((s) => s.currentFileId)
  const error = useStore((s) => s.error)

  useEffect(() => {
    if (!containerRef.current) return
    const instance = createAlphaTab(containerRef.current)
    instance.error.on((e) => {
      console.error('alphaTab error', e)
      store.setState({ error: e.message })
    })
    apiRef.current = instance
    setApi(instance)
    return () => {
      instance.destroy()
      apiRef.current = null
      setApi(null)
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
      <div
        style={{
          padding: '0.5rem 1rem',
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid #eee',
          background: '#fff',
        }}
      >
        <button type="button" onClick={() => api?.playPause()} disabled={!api || !currentFileId}>
          Play / Pause
        </button>
        <button type="button" onClick={() => api?.stop()} disabled={!api || !currentFileId}>
          Stop
        </button>
      </div>
      {error && (
        <div style={{ padding: '0.5rem 1rem', background: '#fee', color: '#900', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}
      <div style={{ flex: 1, padding: '1rem', overflow: 'auto', position: 'relative' }}>
        <div ref={containerRef} />
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
            }}
          >
            Drop a Guitar Pro file here, or use the sidebar to add one.
          </div>
        )}
      </div>
    </div>
  )
}
