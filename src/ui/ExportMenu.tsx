import { useState } from 'preact/hooks'
import { store } from '../editor/store'
import { useStore } from './hooks/useStore'
import { EXPORT_FORMATS, downloadCurrentScore, type ExportFormat } from '../persistence/export'

/**
 * Header "Export…" control (Phase 6). A button + popover offering the two formats alphaTab can write:
 * Guitar Pro 7 (`.gp`, full-fidelity binary) and alphaTex (`.alphatab`, human-readable text). Mirrors
 * the EffectsPanel popover idiom (backdrop + absolute menu). Disabled until a score is loaded.
 */
export function ExportMenu() {
  const [open, setOpen] = useState(false)
  // Gate on `tracks` (not `currentFileId`): tracks are populated in the `scoreLoaded` handler, i.e.
  // exactly when `api.score` becomes exportable, and cleared to [] on unload. `currentFileId` flips
  // earlier — before the async `api.load` — and wouldn't re-render us when the score actually arrives.
  const hasScore = useStore((s) => s.tracks.length > 0)

  function choose(format: ExportFormat) {
    setOpen(false)
    try {
      downloadCurrentScore(format)
    } catch (err) {
      console.error('[export] failed', err)
      store.setState({ error: 'Export failed — see console.' })
    }
  }

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        disabled={!hasScore}
        onClick={() => setOpen((o) => !o)}
        style={buttonStyle(!hasScore)}
      >
        Export ▾
      </button>
      {open && hasScore && (
        <>
          <div style={backdropStyle} onClick={() => setOpen(false)} />
          <div style={popoverStyle}>
            <div style={popLabelStyle}>Export as</div>
            {EXPORT_FORMATS.map((f) => (
              <button key={f.format} type="button" onClick={() => choose(f.format)} style={popItemStyle}>
                {f.label}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  )
}

function buttonStyle(disabled: boolean) {
  return {
    fontSize: '0.8rem',
    padding: '4px 10px',
    borderRadius: 4,
    cursor: disabled ? 'default' : 'pointer',
    border: '1px solid #ccc',
    background: disabled ? '#f5f5f5' : '#fff',
    color: disabled ? '#bbb' : '#333',
  }
}

const backdropStyle = { position: 'fixed' as const, inset: 0, zIndex: 10 }
const popoverStyle = {
  position: 'absolute' as const,
  top: '100%',
  right: 0,
  marginTop: 4,
  zIndex: 11,
  background: '#fff',
  border: '1px solid #ccc',
  borderRadius: 6,
  boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
  padding: '4px',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 2,
  minWidth: 180,
}
const popLabelStyle = {
  color: '#999',
  fontSize: '0.65rem',
  textTransform: 'uppercase' as const,
  padding: '4px 6px 2px',
}
const popItemStyle = {
  textAlign: 'left' as const,
  fontSize: '0.8rem',
  padding: '5px 8px',
  borderRadius: 4,
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  color: '#333',
}
