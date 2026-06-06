import { useEffect, useRef } from 'preact/hooks'
import { synth, type AlphaTabApi, type model } from '@coderline/alphatab'
import { createAlphaTab } from '../alphatab/api'
import { store, DEFAULT_TRANSPORT } from '../editor/store'
import { useStore } from './hooks/useStore'
import { getFileBytes } from '../persistence/db'
import { applyTransportToApi } from '../editor/transport'
import { syncSoundFont } from '../editor/soundfont'
import { selectByBeat, selectByNote, setRangeFocusByBeat } from '../editor/selection'
import { seekToBeat } from '../editor/transport'
import { clearHistory } from '../editor/HistoryRouter'
import { SelectionOverlay } from './SelectionOverlay'
import { ScoreInfoBar } from './ScoreInfoBar'

export function ScoreView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<AlphaTabApi | null>(null)
  const currentFileId = useStore((s) => s.currentFileId)
  const error = useStore((s) => s.error)
  const warning = useStore((s) => s.warning)

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
      // New score → old BeatRefs are meaningless; drop selection and undo history.
      clearHistory()
      store.setState({
        tracks: score.tracks.map((t) => ({
          index: t.index,
          name: t.name,
          rendered: true,
          muted: false,
          soloed: false,
        })),
        selection: null,
        warning: null,
      })
      applyTransportToApi(instance, store.getState().transport)
    })
    // beatMouseDown/noteMouseDown carry no modifier keys, so capture them off the raw event here.
    let lastClickSeek = false
    let lastClickShift = false
    const onMouseDownCapture = (e: MouseEvent) => {
      lastClickSeek = e.metaKey || e.ctrlKey
      lastClickShift = e.shiftKey
    }
    const containerEl = containerRef.current
    containerEl.addEventListener('mousedown', onMouseDownCapture, true)
    instance.beatMouseDown.on((beat) => {
      if (lastClickSeek) seekToBeat(instance, beat)
      else if (lastClickShift) setRangeFocusByBeat(beat) // Shift+click extends the range to here
      else selectByBeat(beat)
    })
    // Clicking a note head also picks its string (beatMouseDown carries no string). Fires alongside
    // beatMouseDown; both set the same beat, and this additionally pins selectedString. Skipped on a
    // seek-click so Cmd/Ctrl-click still just moves the playhead, and on a Shift-click so the range
    // extension (set by beatMouseDown) isn't immediately collapsed back to a single beat.
    instance.noteMouseDown.on((note) => {
      if (!lastClickSeek && !lastClickShift) selectByNote(note)
    })
    // The player instance only exists once a score is loaded; midiLoaded is the first event that
    // fires with a live player (and unlike playerReady it doesn't wait for a soundfont, which is
    // exactly what we're about to provide). syncSoundFont() no-ops when already in sync.
    instance.midiLoaded.on(() => {
      void syncSoundFont()
    })
    instance.playerStateChanged.on((args) => {
      const t = store.getState().transport
      const playing = args.state === synth.PlayerState.Playing
      if (t.playing === playing) return
      store.setState({ transport: { ...t, playing } })
    })
    apiRef.current = instance
    store.setState({ api: instance })
    return () => {
      containerEl.removeEventListener('mousedown', onMouseDownCapture, true)
      instance.destroy()
      apiRef.current = null
      clearHistory()
      store.setState({ api: null, transport: DEFAULT_TRANSPORT, tracks: [], selection: null })
    }
  }, [])

  useEffect(() => {
    if (!apiRef.current || !currentFileId) return
    let cancelled = false
    getFileBytes(currentFileId).then((bytes) => {
      if (cancelled || !apiRef.current || !bytes) return
      store.setState({ error: null, warning: null })
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
      {warning && (
        <div
          style={{
            padding: '0.5rem 1rem',
            background: '#fff8e1',
            color: '#8a6d00',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            borderBottom: '1px solid #f0e3b0',
          }}
        >
          <span style={{ flex: 1 }}>{warning}</span>
          <button
            type="button"
            onClick={() => store.setState({ warning: null })}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#8a6d00',
              cursor: 'pointer',
              fontSize: '1rem',
              lineHeight: 1,
              padding: '0 0.25rem',
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <ScoreInfoBar />
      <div
        ref={scrollRef}
        style={{ flex: 1, overflow: 'auto', position: 'relative', background: '#fafafa' }}
      >
        <div style={{ padding: '1rem' }}>
          <div style={{ position: 'relative' }}>
            <div ref={containerRef} />
            <SelectionOverlay />
          </div>
        </div>
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
