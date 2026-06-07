import { useEffect } from 'preact/hooks'
import type { JSX } from 'preact'
import { store } from './editor/store'
import { listFiles } from './persistence/db'
import { importFiles } from './persistence/import'
import { seedExampleTab } from './persistence/seedExample'
import { attachAutosave } from './persistence/autosave'
import { Sidebar } from './ui/Sidebar'
import { ScoreView } from './ui/ScoreView'
import { Transport } from './ui/Transport'
import { EffectsPanel } from './ui/EffectsPanel'
import { ExportMenu } from './ui/ExportMenu'
import { attachKeyboard } from './input/keyboard'

export function App() {
  useEffect(() => {
    void (async () => {
      const files = await listFiles()
      const seeded = await seedExampleTab(files)
      if (seeded) {
        store.setState({ files: [seeded, ...files], currentFileId: seeded.id })
      } else {
        store.setState({ files })
      }
    })()
  }, [])

  useEffect(() => attachKeyboard(), [])
  useEffect(() => attachAutosave(), [])

  // Dev-only hook: `window.__transcribe()` opens a file picker (or pass a File directly) and runs the
  // audio→tab pipeline, opening the result as a new tab. No UI yet — wired up by hand for now.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const fn = (file?: File) => {
      import('./transcribe/transcribe').then(({ transcribeToNewTab }) => {
        if (file instanceof File) return void transcribeToNewTab(file).catch(console.error)
        const input = document.createElement('input')
        input.type = 'file'
        // Intentionally unrestricted: a narrow accept can hide .wav in some pickers, and this is dev-only.
        input.onchange = () => {
          const f = input.files?.[0]
          if (f) transcribeToNewTab(f).catch(console.error)
        }
        input.click()
      })
    }
    ;(window as unknown as { __transcribe?: typeof fn }).__transcribe = fn
    console.info('[transcribe] dev hook ready — call window.__transcribe() to pick an audio file')
    return () => {
      delete (window as unknown as { __transcribe?: typeof fn }).__transcribe
    }
  }, [])

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
        <span style={{ color: '#888', fontSize: '0.8rem' }}>
          Click a note · type 0–9 = fret · ↑/↓ switch string · −/+ = length · Enter plays from here
        </span>
        <span style={{ marginLeft: 'auto' }} />
        <ExportMenu />
      </header>
      <Transport />
      <EffectsPanel />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Sidebar />
        <ScoreView />
      </div>
    </div>
  )
}
