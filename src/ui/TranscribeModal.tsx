import { useEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { warm } from '../transcribe/workerClient'
import { analyzeClip, openNotesAsNewTab, stem, type AnalyzedClip } from '../transcribe/transcribe'
import { DEFAULT_BPM } from '../transcribe/detectTempo'
import { startRecording, type RecorderHandle } from '../transcribe/record'

// Cap on clip length (uploads) and recording duration — guards memory and amortizes the model
// cold-start. 120s per the phase decision; a forgotten-running mic auto-stops here too.
const MAX_CLIP_SECONDS = 120

// Manual BPM override bounds — deliberately wider than detection's 70–160 band; the user knows best.
const BPM_INPUT_MIN = 30
const BPM_INPUT_MAX = 300

type WarmState = 'warming' | 'ready' | 'failed'
// 'review' = inference done; the detected BPM is shown for override before the tab is created.
type Phase = 'idle' | 'recording' | 'transcribing' | 'review' | 'creating'

interface Clip {
  blob: Blob
  name: string
  url: string
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Read an audio blob/file's duration via a throwaway <audio> element (no decode). */
function probeDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio()
    a.preload = 'metadata'
    a.onloadedmetadata = () => resolve(a.duration)
    a.onerror = () => resolve(NaN)
    a.src = url
  })
}

/**
 * The transcribe-audio flow: pick a file OR record from the mic, preview it, run inference (in the
 * worker), review/override the detected tempo, then open the result as a new tab. Warms the worker on
 * open so the model cold-start is paid before the user hits Transcribe. Every edit after the new tab
 * opens still goes through the Command stack — this only mints the file.
 */
export function TranscribeModal({ onClose }: { onClose: () => void }) {
  const [warmState, setWarmState] = useState<WarmState>('warming')
  const [phase, setPhase] = useState<Phase>('idle')
  const [clip, setClip] = useState<Clip | null>(null)
  const [progress, setProgress] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Inference output held for the review step — overriding the BPM rebuilds from these cached notes
  // without re-running the model.
  const [analysis, setAnalysis] = useState<AnalyzedClip | null>(null)
  const [bpmText, setBpmText] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<RecorderHandle | null>(null)
  const timerRef = useRef<number | null>(null)
  const clipRef = useRef<Clip | null>(null)
  clipRef.current = clip

  // Warm the worker (load tfjs + model, compile WebGL shaders) as soon as the modal opens.
  useEffect(() => {
    let live = true
    warm()
      .then(({ backend }) => {
        if (!live) return
        setWarmState('ready')
        // Light bench: surface the backend the worker actually settled on (webgl vs cpu fallback).
        console.info(`[transcribe] worker warm · backend=${backend}`)
      })
      .catch((e) => {
        if (live) {
          setWarmState('failed')
          console.error('[transcribe] warmup failed', e)
        }
      })
    return () => {
      live = false
    }
  }, [])

  // Clean up the mic, timer, and object URL on unmount (covers closing mid-record).
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearInterval(timerRef.current)
      recorderRef.current?.cancel()
      if (clipRef.current) URL.revokeObjectURL(clipRef.current.url)
    },
    [],
  )

  function setClipFrom(blob: Blob, name: string) {
    if (clip) URL.revokeObjectURL(clip.url)
    setClip({ blob, name, url: URL.createObjectURL(blob) })
    // A new clip invalidates any previous inference — back to the pre-transcribe state.
    setAnalysis(null)
    setPhase('idle')
  }

  async function onPickFile(ev: JSX.TargetedEvent<HTMLInputElement, Event>) {
    const input = ev.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    setError(null)
    const url = URL.createObjectURL(file)
    const dur = await probeDuration(url)
    // Known gap: if metadata is unreadable (dur = NaN) we let it through rather than block a
    // possibly-fine file. Same-browser codecs almost always report duration; if not, decode/inference
    // downstream still bounds the damage at the 120s-equivalent buffer.
    if (Number.isFinite(dur) && dur > MAX_CLIP_SECONDS) {
      URL.revokeObjectURL(url)
      setError(`Clip is ${fmt(dur)} — keep it under ${fmt(MAX_CLIP_SECONDS)}.`)
      return
    }
    URL.revokeObjectURL(url) // probe-only URL; setClipFrom mints its own
    setClipFrom(file, file.name)
  }

  function stopTimer() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  async function onStartRecord() {
    setError(null)
    try {
      const handle = await startRecording()
      recorderRef.current = handle
      setPhase('recording')
      setElapsed(0)
      const startedAt = performance.now()
      timerRef.current = window.setInterval(() => {
        const secs = (performance.now() - startedAt) / 1000
        setElapsed(secs)
        if (secs >= MAX_CLIP_SECONDS) void onStopRecord()
      }, 250)
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ''
      setError(
        name === 'NotAllowedError'
          ? 'Microphone permission denied.'
          : name === 'NotFoundError'
            ? 'No microphone found.'
            : e instanceof Error
              ? e.message
              : 'Could not start recording.',
      )
    }
  }

  async function onStopRecord() {
    const handle = recorderRef.current
    if (!handle) return
    recorderRef.current = null
    stopTimer()
    const { blob } = await handle.stop()
    setPhase('idle')
    setClipFrom(blob, 'Recording')
  }

  async function onTranscribe() {
    if (!clip) return
    setError(null)
    setPhase('transcribing')
    setProgress(0)
    try {
      const result = await analyzeClip(clip.blob, setProgress)
      setAnalysis(result)
      setBpmText(String(result.detectedBpm ?? DEFAULT_BPM))
      setPhase('review')
    } catch (e) {
      console.error('[transcribe] failed', e)
      setError(e instanceof Error ? e.message : 'Transcription failed.')
      setPhase('idle')
    }
  }

  // The override field accepts integer BPM in a deliberately wide band; out-of-band disables Create.
  const bpm = /^\d+$/.test(bpmText.trim()) ? Number(bpmText.trim()) : NaN
  const bpmValid = Number.isInteger(bpm) && bpm >= BPM_INPUT_MIN && bpm <= BPM_INPUT_MAX

  async function onCreateTab() {
    if (!clip || !analysis || !bpmValid) return
    setError(null)
    setPhase('creating')
    try {
      const name = clip.name === 'Recording' ? 'Recording' : stem(clip.name)
      await openNotesAsNewTab(analysis.notes, name, bpm)
      onClose() // the new tab is now the current file (openNotesAsNewTab set the store)
    } catch (e) {
      console.error('[transcribe] create failed', e)
      setError(e instanceof Error ? e.message : 'Could not create the tab.')
      setPhase('review')
    }
  }

  const busy = phase === 'transcribing' || phase === 'creating'
  const recording = phase === 'recording'
  const reviewing = phase === 'review'
  // Require a settled model: a failed warm leaves the worker's load() promise unusable, so
  // Transcribe would error rather than just run slow. Reopening the modal retries the warm.
  const canTranscribe = !!clip && !busy && !recording && warmState === 'ready'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Transcribe audio to tab"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: '90vw',
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          padding: '1rem 1.25rem',
          fontSize: '0.9rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
          <strong style={{ fontSize: '1rem' }}>Transcribe audio → tab</strong>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            style={{ border: 'none', background: 'transparent', fontSize: '1.2rem', cursor: 'pointer', color: '#888' }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            background: '#fff8e1',
            color: '#8a6d00',
            border: '1px solid #f0e3b0',
            borderRadius: 4,
            padding: '0.4rem 0.6rem',
            marginBottom: '0.75rem',
            lineHeight: 1.35,
          }}
        >
          ⚠ Any audio works, but results are best on a <strong>single instrument playing one note at a
          time</strong>. Chords and full mixes won't transcribe cleanly yet.
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy || recording}>
            Choose file…
          </button>
          {recording ? (
            <button type="button" onClick={onStopRecord}>
              ■ Stop ({fmt(elapsed)})
            </button>
          ) : (
            <button type="button" onClick={onStartRecord} disabled={busy}>
              ● Record
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.webm"
            style={{ display: 'none' }}
            onChange={onPickFile}
          />
        </div>

        {recording && (
          <p style={{ color: '#900', margin: '0 0 0.75rem' }}>
            ● Recording… auto-stops at {fmt(MAX_CLIP_SECONDS)}
          </p>
        )}

        {clip && !recording && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: 2 }}>{clip.name}</div>
            <audio controls src={clip.url} style={{ width: '100%' }} />
          </div>
        )}

        {error && (
          <div style={{ background: '#fee', color: '#900', borderRadius: 4, padding: '0.4rem 0.6rem', marginBottom: '0.75rem' }}>
            {error}
          </div>
        )}

        {phase === 'transcribing' && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: 4 }}>
              Transcribing… {Math.round(progress * 100)}%
            </div>
            <div style={{ height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: '#4a6cff', transition: 'width 0.15s' }} />
            </div>
          </div>
        )}

        {(reviewing || phase === 'creating') && analysis && (
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>{analysis.detectedBpm !== null ? 'Detected tempo:' : 'Tempo:'}</span>
              <input
                type="number"
                min={BPM_INPUT_MIN}
                max={BPM_INPUT_MAX}
                step={1}
                value={bpmText}
                disabled={busy}
                onInput={(e) => setBpmText(e.currentTarget.value)}
                style={{
                  width: '4.5rem',
                  padding: '0.25rem 0.4rem',
                  border: `1px solid ${bpmValid ? '#ccc' : '#c00'}`,
                  borderRadius: 4,
                }}
              />
              <span style={{ color: '#666' }}>BPM</span>
            </label>
            <div style={{ fontSize: '0.75rem', color: '#999', marginTop: 4 }}>
              {analysis.detectedBpm === null &&
                `Couldn't detect a tempo — defaulting to ${DEFAULT_BPM}. `}
              {bpmValid
                ? 'Adjust if it sounds off, then create the tab.'
                : `Enter a whole number between ${BPM_INPUT_MIN} and ${BPM_INPUT_MAX}.`}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: warmState === 'failed' ? '#900' : '#999' }}>
            {warmState === 'warming' && 'Warming model…'}
            {warmState === 'failed' && 'Model failed to load — reopen to retry.'}
            {warmState === 'ready' && 'Model ready'}
          </span>
          <span style={{ flex: 1 }} />
          {reviewing || phase === 'creating' ? (
            <button
              type="button"
              onClick={onCreateTab}
              disabled={busy || !bpmValid}
              style={{
                padding: '0.4rem 0.9rem',
                background: !busy && bpmValid ? '#4a6cff' : '#ccc',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: !busy && bpmValid ? 'pointer' : 'default',
              }}
            >
              {phase === 'creating' ? 'Creating…' : 'Create tab'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onTranscribe}
              disabled={!canTranscribe}
              style={{
                padding: '0.4rem 0.9rem',
                background: canTranscribe ? '#4a6cff' : '#ccc',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: canTranscribe ? 'pointer' : 'default',
              }}
            >
              Transcribe
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
