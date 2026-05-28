import { useEffect } from 'preact/hooks'
import type { JSX } from 'preact'
import { store } from './editor/store'
import { listFiles } from './persistence/db'
import { importFiles } from './persistence/import'
import { Sidebar } from './ui/Sidebar'
import { ScoreView } from './ui/ScoreView'
import { Transport } from './ui/Transport'
import { attachKeyboard } from './input/keyboard'

export function App() {
  useEffect(() => {
    listFiles().then((files) => store.setState({ files }))
  }, [])

  useEffect(() => attachKeyboard(), [])

  function onDrop(ev: JSX.TargetedDragEvent<HTMLDivElement>) {
    ev.preventDefault()
    const dt = ev.dataTransfer
    if (!dt || dt.files.length === 0) return
    importFiles(Array.from(dt.files))
  }

  function onDragOver(ev: JSX.TargetedDragEvent<HTMLDivElement>) {
    ev.preventDefault()
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
  }

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <header
        style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid #ddd',
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
          background: '#fff',
        }}
      >
        <strong>fretwork</strong>
        <span style={{ color: '#666', fontSize: '0.85rem' }}>Phase 1 — viewer</span>
        <span style={{ marginLeft: 'auto', color: '#888', fontSize: '0.8rem' }}>
          Click a beat to select · ⌘/Ctrl-click or Enter to seek
        </span>
      </header>
      <Transport />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Sidebar />
        <ScoreView />
      </div>
    </div>
  )
}
