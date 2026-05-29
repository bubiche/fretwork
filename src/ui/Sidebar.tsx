import { useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { useStore } from './hooks/useStore'
import { store } from '../editor/store'
import { listFiles, touchLastOpened, renameFile, deleteFile } from '../persistence/db'
import { importFiles } from '../persistence/import'
import { Tracks } from './Tracks'
import { KeyboardHelp } from './KeyboardHelp'

export function Sidebar() {
  const files = useStore((s) => s.files)
  const currentFileId = useStore((s) => s.currentFileId)
  const inputRef = useRef<HTMLInputElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  async function onPick(ev: JSX.TargetedEvent<HTMLInputElement, Event>) {
    const input = ev.currentTarget
    const fs = input.files
    if (!fs) return
    await importFiles(Array.from(fs))
    input.value = ''
  }

  async function open(id: string) {
    if (editingId) return
    await touchLastOpened(id)
    const list = await listFiles()
    store.setState({ files: list, currentFileId: id, error: null })
  }

  function startRename(id: string, current: string) {
    setEditingId(id)
    setDraft(current)
  }

  async function commitRename(id: string) {
    const name = draft.trim()
    if (name && name !== files.find((f) => f.id === id)?.name) {
      await renameFile(id, name)
      const list = await listFiles()
      store.setState({ files: list })
    }
    setEditingId(null)
    setDraft('')
  }

  function cancelRename() {
    setEditingId(null)
    setDraft('')
  }

  async function onDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return
    await deleteFile(id)
    const list = await listFiles()
    const wasCurrent = store.getState().currentFileId === id
    store.setState({
      files: list,
      ...(wasCurrent ? { currentFileId: null, error: null } : {}),
    })
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
          {files.map((f) => {
            const editing = editingId === f.id
            const isCurrent = f.id === currentFileId
            return (
              <li
                key={f.id}
                style={{
                  background: isCurrent ? '#e8ecff' : 'transparent',
                  borderRadius: 4,
                  padding: '0.4rem 0.5rem',
                  marginBottom: 2,
                }}
              >
                {editing ? (
                  <input
                    autoFocus
                    type="text"
                    value={draft}
                    onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
                    onBlur={() => commitRename(f.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(f.id)
                      else if (e.key === 'Escape') cancelRename()
                    }}
                    style={{ width: '100%', fontSize: '0.85rem', padding: '2px 4px' }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => open(f.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#888' }}>
                      {(f.size / 1024).toFixed(1)} KB
                    </div>
                  </button>
                )}
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => startRename(f.id, f.name)}
                    disabled={editing}
                    style={rowBtnStyle}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(f.id, f.name)}
                    style={rowBtnStyle}
                  >
                    Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <Tracks />
      <KeyboardHelp />
    </aside>
  )
}

const rowBtnStyle = {
  fontSize: '0.7rem',
  padding: '1px 6px',
  background: 'transparent',
  border: '1px solid #ccc',
  borderRadius: 3,
  cursor: 'pointer',
  color: '#555',
}
