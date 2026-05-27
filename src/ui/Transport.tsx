import type { JSX } from 'preact'
import { useStore } from './hooks/useStore'
import { setTransport } from '../editor/transport'
import { setZoom, setLayoutMode } from '../editor/view'
import type { LayoutModeOption } from '../editor/store'

export function Transport() {
  const api = useStore((s) => s.api)
  const currentFileId = useStore((s) => s.currentFileId)
  const transport = useStore((s) => s.transport)
  const view = useStore((s) => s.view)
  const enabled = !!api && !!currentFileId

  function onSpeed(ev: JSX.TargetedEvent<HTMLInputElement, Event>) {
    setTransport({ playbackSpeed: parseFloat(ev.currentTarget.value) })
  }

  function onZoom(ev: JSX.TargetedEvent<HTMLInputElement, Event>) {
    setZoom(parseFloat(ev.currentTarget.value))
  }

  const speedPct = Math.round(transport.playbackSpeed * 100)
  const zoomPct = Math.round(view.zoom * 100)

  return (
    <div
      style={{
        padding: '0.5rem 1rem',
        display: 'flex',
        gap: '1rem',
        alignItems: 'center',
        borderBottom: '1px solid #eee',
        background: '#fff',
        fontSize: '0.85rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', gap: '0.25rem' }}>
        <button
          type="button"
          onClick={() => api?.playPause()}
          disabled={!enabled}
          style={{ minWidth: '5ch' }}
        >
          {transport.playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={() => api?.stop()} disabled={!enabled}>
          Stop
        </button>
      </div>

      <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
        <span>Tempo</span>
        <input
          type="range"
          min={0.25}
          max={2}
          step={0.05}
          value={transport.playbackSpeed}
          onInput={onSpeed}
          disabled={!enabled}
        />
        <span style={{ minWidth: '4ch', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {speedPct}%
        </span>
        <button
          type="button"
          onClick={() => setTransport({ playbackSpeed: 1 })}
          disabled={!enabled || transport.playbackSpeed === 1}
          title="Reset to 100%"
          style={{ fontSize: '0.75rem', padding: '0 6px' }}
        >
          1×
        </button>
      </label>

      <label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={transport.metronome}
          onChange={(e) => setTransport({ metronome: (e.currentTarget as HTMLInputElement).checked })}
          disabled={!enabled}
        />
        Metronome
      </label>

      <label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={transport.countIn}
          onChange={(e) => setTransport({ countIn: (e.currentTarget as HTMLInputElement).checked })}
          disabled={!enabled}
        />
        Count-in
      </label>

      <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
        <span>Zoom</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={view.zoom}
          onInput={onZoom}
          disabled={!enabled}
        />
        <span style={{ minWidth: '4ch', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {zoomPct}%
        </span>
        <button
          type="button"
          onClick={() => setZoom(1)}
          disabled={!enabled || view.zoom === 1}
          title="Reset to 100%"
          style={{ fontSize: '0.75rem', padding: '0 6px' }}
        >
          1×
        </button>
      </label>

      <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
        <span>Layout</span>
        <select
          value={view.layoutMode}
          onChange={(e) =>
            setLayoutMode((e.currentTarget as HTMLSelectElement).value as LayoutModeOption)
          }
          disabled={!enabled}
        >
          <option value="page">Page</option>
          <option value="horizontal">Horizontal</option>
        </select>
      </label>
    </div>
  )
}
