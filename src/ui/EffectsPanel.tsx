import { useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { model } from '@coderline/alphatab'
import { useStore } from './hooks/useStore'
import { resolveNote } from '../editor/ScoreMutator'
import { resolveBeat } from '../editor/selection'
import {
  toggleSelectedPalmMute,
  toggleSelectedGhost,
  toggleSelectedDead,
  cycleSelectedVibrato,
  stepSelectedDynamics,
  DYNAMICS_LADDER,
  toggleSelectedLetRing,
  toggleSelectedHammerPull,
  tieSelectedNote,
  setSelectedSlideOut,
  setSelectedSlideIn,
} from '../editor/commands'

/**
 * The Phase 4 effects panel — a docked inspector (a bar under the Transport), NOT a static toolbar.
 * Each control reflects the current target's state (subscribes to scoreVersion/selection/
 * selectedString, reads the resolved note/beat) and calls a dispatcher on click. It never mutates
 * the score directly — every edit is a Command (the same invariant the keyboard handlers follow).
 *
 * 4a fills the Articulation and Pitch groups; Advanced and Chord arrive in 4b.
 */
export function EffectsPanel() {
  const api = useStore((s) => s.api)
  const selection = useStore((s) => s.selection)
  const selectedString = useStore((s) => s.selectedString)
  // Re-render on every model edit so the controls reflect the latest field values (note refs can
  // stay identical across an in-place edit; scoreVersion is the reliable invalidation signal).
  useStore((s) => s.scoreVersion)

  const score = api?.score ?? null
  const note = score && selection ? resolveNote(score, selection, selectedString) : null
  const beat = score && selection ? resolveBeat(score, selection) : null

  const hasSelection = !!selection && !!score
  const hasNote = !!note

  const dynLabel = beat ? DYNAMICS_LABELS[DYNAMICS_LADDER.indexOf(beat.dynamics)] ?? '—' : '—'
  const slideActive = !!note && (note.slideOutType !== 0 || note.slideInType !== 0)

  return (
    <div style={barStyle}>
      <Group title="Articulation">
        <Toggle label="Palm mute" active={!!note?.isPalmMute} disabled={!hasNote} onClick={toggleSelectedPalmMute} />
        <Toggle label="Ghost" active={!!note?.isGhost} disabled={!hasNote} onClick={toggleSelectedGhost} />
        <Toggle label="Dead" active={!!note?.isDead} disabled={!hasNote} onClick={toggleSelectedDead} />
        <Toggle
          label={`Vibrato${note && note.vibrato ? `: ${VIBRATO_LABELS[note.vibrato]}` : ''}`}
          active={!!note?.vibrato}
          disabled={!hasNote}
          onClick={cycleSelectedVibrato}
        />
        <Toggle
          label="Tie"
          active={!!note?.isTieDestination}
          // Apply-only in 4a: disabled once tied (remove via undo). See TieCommand.
          disabled={!hasNote || !!note?.isTieDestination}
          onClick={tieSelectedNote}
        />
        <span style={dividerStyle} />
        <Stepper
          label="Dynamics"
          value={dynLabel}
          disabled={!beat}
          onDown={() => stepSelectedDynamics(-1)}
          onUp={() => stepSelectedDynamics(1)}
        />
      </Group>

      <span style={groupDividerStyle} />

      <Group title="Pitch">
        <Toggle label="Let ring" active={!!note?.isLetRing} disabled={!hasNote} onClick={toggleSelectedLetRing} />
        <Toggle label="HO/PO" active={!!note?.isHammerPullOrigin} disabled={!hasNote} onClick={toggleSelectedHammerPull} />
        <SlideControl note={note} active={slideActive} disabled={!hasNote} />
      </Group>

      {!hasSelection && <span style={hintStyle}>Select a beat to edit effects</span>}
    </div>
  )
}

// ── Slide submenu (the one 4a popover control) ──────────────────────────────────────────────────
const SLIDE_OUT_OPTIONS: { label: string; value: model.SlideOutType }[] = [
  { label: 'None', value: model.SlideOutType.None },
  { label: 'Shift', value: model.SlideOutType.Shift },
  { label: 'Legato', value: model.SlideOutType.Legato },
  { label: 'Out ↗', value: model.SlideOutType.OutUp },
  { label: 'Out ↘', value: model.SlideOutType.OutDown },
]
const SLIDE_IN_OPTIONS: { label: string; value: model.SlideInType }[] = [
  { label: 'None', value: model.SlideInType.None },
  { label: 'In ↗ from below', value: model.SlideInType.IntoFromBelow },
  { label: 'In ↘ from above', value: model.SlideInType.IntoFromAbove },
]

function SlideControl({
  note,
  active,
  disabled,
}: {
  note: model.Note | null
  active: boolean
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const outType = note?.slideOutType ?? 0
  const inType = note?.slideInType ?? 0
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <Toggle label="Slide ▾" active={active} disabled={disabled} onClick={() => setOpen((o) => !o)} />
      {open && !disabled && (
        <>
          <div style={backdropStyle} onClick={() => setOpen(false)} />
          <div style={popoverStyle}>
            <div style={popLabelStyle}>Slide out</div>
            {SLIDE_OUT_OPTIONS.map((o) => (
              <PopItem
                key={`out-${o.value}`}
                label={o.label}
                active={outType === o.value}
                onClick={() => {
                  setSelectedSlideOut(o.value)
                  setOpen(false)
                }}
              />
            ))}
            <div style={popLabelStyle}>Slide in</div>
            {SLIDE_IN_OPTIONS.map((o) => (
              <PopItem
                key={`in-${o.value}`}
                label={o.label}
                active={inType === o.value}
                onClick={() => {
                  setSelectedSlideIn(o.value)
                  setOpen(false)
                }}
              />
            ))}
          </div>
        </>
      )}
    </span>
  )
}

// ── Small presentational helpers (vanilla inline styles, matching the rest of the UI) ───────────
function Group({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
      <span style={groupTitleStyle}>{title}</span>
      {children}
    </div>
  )
}

function Toggle({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string
  active: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} style={btnStyle(active, disabled)}>
      {label}
    </button>
  )
}

function Stepper({
  label,
  value,
  disabled,
  onDown,
  onUp,
}: {
  label: string
  value: string
  disabled: boolean
  onDown: () => void
  onUp: () => void
}) {
  return (
    <span style={{ display: 'inline-flex', gap: '0.2rem', alignItems: 'center' }}>
      <span style={{ color: disabled ? '#bbb' : '#555' }}>{label}</span>
      <button type="button" disabled={disabled} onClick={onDown} style={btnStyle(false, disabled)}>
        −
      </button>
      <span style={{ minWidth: 26, textAlign: 'center', color: disabled ? '#bbb' : '#222', fontWeight: 600 }}>
        {value}
      </span>
      <button type="button" disabled={disabled} onClick={onUp} style={btnStyle(false, disabled)}>
        +
      </button>
    </span>
  )
}

function PopItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={popItemStyle(active)}>
      {label}
    </button>
  )
}

const VIBRATO_LABELS: Record<number, string> = { 1: 'slight', 2: 'wide' }
const DYNAMICS_LABELS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff']

const barStyle = {
  padding: '0.4rem 1rem',
  display: 'flex',
  gap: '0.6rem',
  alignItems: 'center',
  borderBottom: '1px solid #eee',
  background: '#fff',
  fontSize: '0.8rem',
  flexWrap: 'wrap' as const,
}
const groupTitleStyle = {
  color: '#999',
  fontSize: '0.7rem',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.04em',
  marginRight: '0.15rem',
}
const dividerStyle = { width: 1, height: 18, background: '#e2e2e2', margin: '0 0.2rem' }
const groupDividerStyle = { width: 1, height: 22, background: '#ddd' }
const hintStyle = { color: '#aaa', fontStyle: 'italic' as const, marginLeft: 'auto' }

function btnStyle(active: boolean, disabled: boolean) {
  return {
    fontSize: '0.78rem',
    padding: '3px 8px',
    borderRadius: 4,
    cursor: disabled ? 'default' : 'pointer',
    border: `1px solid ${active ? '#5a6ee0' : '#ccc'}`,
    background: disabled ? '#f5f5f5' : active ? '#5a6ee0' : '#fff',
    color: disabled ? '#bbb' : active ? '#fff' : '#333',
  }
}

const backdropStyle = { position: 'fixed' as const, inset: 0, zIndex: 10 }
const popoverStyle = {
  position: 'absolute' as const,
  top: '100%',
  left: 0,
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
  minWidth: 150,
}
const popLabelStyle = {
  color: '#999',
  fontSize: '0.65rem',
  textTransform: 'uppercase' as const,
  padding: '4px 6px 2px',
}
function popItemStyle(active: boolean) {
  return {
    textAlign: 'left' as const,
    fontSize: '0.78rem',
    padding: '4px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    border: 'none',
    background: active ? '#eef0fd' : 'transparent',
    color: active ? '#3a4ec0' : '#333',
    fontWeight: active ? 600 : 400,
  }
}
