import { useEffect, useState } from 'preact/hooks'
import { useStore } from './hooks/useStore'
import { setScoreInfo } from '../editor/commands'

/**
 * Thin bar above the score with Title / Artist inputs editing the rendered score header (the
 * metadata alphaTab draws above the first system — distinct from the sidebar file name).
 * Commits on blur (Enter blurs, Escape reverts-then-blurs) through the Command stack, so the
 * edit is undoable and auto-saved like any other.
 *
 * Inputs are uncontrolled (`defaultValue`) and re-mounted via `key` whenever the model value
 * UNDER THAT FIELD changes — keying on the field's own value (not scoreVersion) means committing
 * Title doesn't remount Artist mid-click (focus would land on `<body>`), and an unrelated edit
 * bumping scoreVersion doesn't wipe an in-progress draft. The scoreVersion subscription is still
 * needed: it re-renders the bar after undo/redo so the keys recompute. loadTick covers a file
 * switch (a bare load doesn't bump scoreVersion). Global shortcuts are already shielded while
 * typing (isTextInputTarget in keyboard.ts).
 */
export function ScoreInfoBar() {
  const api = useStore((s) => s.api)
  const scoreVersion = useStore((s) => s.scoreVersion)
  const currentFileId = useStore((s) => s.currentFileId)
  const [loadTick, setLoadTick] = useState(0)

  useEffect(() => {
    if (!api) return
    const bump = () => setLoadTick((n) => n + 1)
    api.scoreLoaded.on(bump)
    return () => {
      api.scoreLoaded.off(bump)
    }
  }, [api])

  const score = api?.score
  if (!currentFileId || !score) return null

  // scoreVersion is read (not used directly) so undo/redo re-renders the bar — see doc comment.
  void scoreVersion
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'center',
        padding: '0.4rem 1rem',
        borderBottom: '1px solid #ddd',
        background: '#fff',
        fontSize: '0.8rem',
      }}
    >
      <InfoField
        label="Title"
        loadTick={loadTick}
        value={score.title}
        onCommit={(v) => setScoreInfo(v, score.artist)}
      />
      <InfoField
        label="Artist"
        loadTick={loadTick}
        value={score.artist}
        onCommit={(v) => setScoreInfo(score.title, v)}
      />
    </div>
  )
}

function InfoField({
  label,
  value,
  loadTick,
  onCommit,
}: {
  label: string
  value: string
  loadTick: number
  onCommit: (value: string) => void
}) {
  return (
    <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', color: '#555' }}>
      {label}
      <input
        key={`${loadTick}:${value}`}
        type="text"
        defaultValue={value}
        onBlur={(e) => {
          // Raw comparison first so an untouched blur (incl. Escape's revert) is a pure no-op
          // even when the stored value has surrounding whitespace; only a real edit commits.
          const raw = e.currentTarget.value
          if (raw === value) return
          onCommit(raw.trim())
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') {
            e.currentTarget.value = value
            e.currentTarget.blur()
          }
        }}
        style={{
          fontSize: '0.8rem',
          padding: '2px 6px',
          border: '1px solid #ccc',
          borderRadius: 4,
          width: 180,
        }}
      />
    </label>
  )
}
