import { useRef } from 'preact/hooks'
import type { JSX } from 'preact'
import { useStore } from './hooks/useStore'
import { store } from '../editor/store'
import { listFiles, touchLastOpened } from '../persistence/db'
import { importFiles } from '../persistence/import'

export function Sidebar() {
  const files = useStore((s) => s.files)
  const currentFileId = useStore((s) => s.currentFileId)
  const inputRef = useRef<HTMLInputElement>(null)

  async function onPick(ev: JSX.TargetedEvent<HTMLInputElement, Event>) {
    const input = ev.currentTarget
    const fs = input.files
    if (!fs) return
    await importFiles(Array.from(fs))
    input.value = ''
  }

  async function open(id: string) {
    await touchLastOpened(id)
    const list = await listFiles()
    store.setState({ files: list, currentFileId: id, error: null })
  }

  return (
    <aside
      style={{
        width: 240,
        flexShrink: 0,
        borderRight: '1px solid #ddd',
        padding: '0.75rem',
        overflowY: 'auto',
        background: '#fff',
      }}
    >
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
        <strong style={{ fontSize: '0.85rem' }}>Files</strong>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => inputRef.current?.click()}>
          Add…
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".gp,.gp3,.gp4,.gp5,.gp6,.gp7,.gp8"
          multiple
          style={{ display: 'none' }}
          onChange={onPick}
        />
      </div>
      {files.length === 0 ? (
        <p style={{ fontSize: '0.8rem', color: '#666', lineHeight: 1.4 }}>
          Drop a Guitar Pro file (.gp, .gp3–.gp8) anywhere on the window, or click <em>Add…</em>.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {files.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => open(f.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: f.id === currentFileId ? '#e8ecff' : 'transparent',
                  border: 'none',
                  padding: '0.4rem 0.5rem',
                  cursor: 'pointer',
                  borderRadius: 4,
                  fontSize: '0.85rem',
                  marginBottom: 2,
                }}
              >
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.name}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#888' }}>{(f.size / 1024).toFixed(1)} KB</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
