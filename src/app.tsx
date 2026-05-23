import { useEffect, useRef, useState } from 'preact/hooks'
import { AlphaTabApi, type json } from '@coderline/alphatab'

const base = import.meta.env.BASE_URL

export function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [api, setApi] = useState<AlphaTabApi | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const instance = new AlphaTabApi(containerRef.current, {
      core: {
        file: `${base}sample.gp`,
        fontDirectory: `${base}font/`,
      },
      player: {
        enablePlayer: true,
        enableCursor: true,
        enableUserInteraction: true,
        soundFont: `${base}soundfont/sonivox.sf3`,
        scrollElement: containerRef.current,
      },
    } as json.SettingsJson)

    instance.error.on((e) => {
      console.error('alphaTab error', e)
      setError(e.message)
    })

    setApi(instance)

    return () => {
      instance.destroy()
    }
  }, [])

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #ddd', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <strong>fretwork</strong>
        <span style={{ color: '#666', fontSize: '0.85rem' }}>Phase 0 spike — hardcoded sample</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => api?.playPause()} disabled={!api}>Play / Pause</button>
        <button type="button" onClick={() => api?.stop()} disabled={!api}>Stop</button>
      </header>
      {error && (
        <div style={{ padding: '0.75rem 1rem', background: '#fee', color: '#900', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}
      <div ref={containerRef} style={{ padding: '1rem' }} />
    </div>
  )
}
