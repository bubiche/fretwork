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
  setSelectedDuration,
  toggleSelectedDot,
  setSelectedFret,
  MAX_FRET,
  toggleSelectedLetRing,
  toggleSelectedHammerPull,
  tieSelectedNote,
  setSelectedSlideOut,
  setSelectedSlideIn,
  BEND_PRESETS,
  setSelectedBend,
  clearSelectedBend,
  WHAMMY_PRESETS,
  setSelectedWhammy,
  clearSelectedWhammy,
  TREMOLO_PRESETS,
  setSelectedTremolo,
  clearSelectedTremolo,
  toggleSelectedTap,
  HARMONIC_OPTIONS,
  setSelectedHarmonic,
  GRACE_OPTIONS,
  setSelectedGrace,
  CHORD_LIBRARY,
  type ChordDef,
  chordPickerEnabled,
  setSelectedChord,
  clearSelectedChord,
  setSelectedTimeSignature,
  setSelectedKeySignature,
  setSelectedTempo,
  insertMeasureAfterSelection,
  deleteSelectedMeasure,
  KEY_SIGNATURE_OPTIONS,
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
  const tremoloActive = !!beat && beat.tremoloSpeed != null
  const harmonicActive = !!note && note.harmonicType !== model.HarmonicType.None
  // Chord is beat-level but library-restricted to standard 6-string tuning — disable on bass/7-string.
  const staff = beat ? beat.voice.bar.staff : null
  const chordEnabled = !!beat && chordPickerEnabled(staff)

  // ── Bar / Measure (Phase 5a) ──────────────────────────────────────────────────────────────────
  // Bar-level controls reflect the SELECTED bar and need only a selection (no note). Time sig is on
  // the shared MasterBar; key sig is per-Bar on the SELECTED track's staff (current-track-only).
  const selMaster = score && selection ? (score.masterBars[selection.barIndex] ?? null) : null
  const selStaff = score && selection ? (score.tracks[selection.trackIndex]?.staves[selection.staffIndex] ?? null) : null
  const selBar = selStaff && selection ? (selStaff.bars[selection.barIndex] ?? null) : null
  const tempoMarker =
    selMaster?.tempoAutomations.find((a) => a.type === model.AutomationType.Tempo && a.ratioPosition === 0) ?? null
  const hasBar = !!selMaster && !!selBar
  const canDelete = !!score && score.masterBars.length > 1

  return (
    <div style={barStyle}>
      {/* Rhythm + Note lead the panel: the two edits a new user reaches for first (note length and
          fret) get the leftmost, plainest controls — clickable equivalents of the −/+ and 0–9 keys.
          Rhythm is beat-level (enabled on any selection); Fret targets the selected string and adds a
          note on an empty one, mirroring the keyboard. */}
      <Group title="Rhythm">
        <DurationButtons duration={beat?.duration ?? null} disabled={!beat} />
        <Toggle label="Dotted" active={!!beat?.dots} disabled={!beat} onClick={toggleSelectedDot} />
      </Group>

      <span style={groupDividerStyle} />

      <Group title="Note">
        <FretControl fret={note?.fret ?? null} disabled={!hasSelection} />
      </Group>

      <span style={groupDividerStyle} />

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
        <BendControl active={!!note?.hasBend} disabled={!hasNote} />
      </Group>

      <span style={groupDividerStyle} />

      <Group title="Advanced">
        {/* Whammy + tremolo + tap are beat-level — enabled whenever a beat is selected, no note
            required. Harmonics + grace are note-level (grace copies the selected note's pitch). */}
        <WhammyControl active={!!beat?.hasWhammyBar} disabled={!beat} />
        <TremoloControl beat={beat} active={tremoloActive} disabled={!beat} />
        <Toggle label="Tap" active={!!beat?.tap} disabled={!beat} onClick={toggleSelectedTap} />
        <HarmonicControl note={note} active={harmonicActive} disabled={!hasNote} />
        <GraceControl disabled={!hasNote} />
      </Group>

      <span style={groupDividerStyle} />

      <Group title="Chord">
        {/* Beat-level. The curated library is standard 6-string only, so the control disables itself
            on any other tuning (chordEnabled). Title shows the assigned chord name. */}
        <ChordControl chordId={beat?.chordId ?? null} disabled={!chordEnabled} />
      </Group>

      <span style={groupDividerStyle} />

      <Group title="Bar / Measure">
        {/* Bar-level inspector: reflects the selected bar and writes on change. Time sig propagates
            across masterbars until the next change; key sig is current-track-only; tempo marker sits
            at bar start. Insert adds an empty measure after the selected bar; delete removes it. */}
        <TimeSigControl
          num={selMaster?.timeSignatureNumerator ?? 4}
          denom={selMaster?.timeSignatureDenominator ?? 4}
          disabled={!hasBar}
        />
        <KeySigControl
          fifths={selBar?.keySignature ?? model.KeySignature.C}
          type={selBar?.keySignatureType ?? model.KeySignatureType.Major}
          disabled={!hasBar}
        />
        <TempoControl
          key={`tempo-${selection?.barIndex ?? 'x'}-${tempoMarker?.value ?? 'none'}`}
          value={tempoMarker?.value ?? null}
          placeholder={score?.tempo ?? 120}
          disabled={!hasBar}
        />
        <span style={dividerStyle} />
        <Toggle label="Insert measure" active={false} disabled={!hasBar} onClick={insertMeasureAfterSelection} />
        <Toggle label="Delete measure" active={false} disabled={!hasBar || !canDelete} onClick={deleteSelectedMeasure} />
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

// ── Bend submenu (note-level preset list + None) ─────────────────────────────────────────────────
// Active = `note.hasBend` (PHASE_4: don't reverse-match points→preset for the highlight; presence is
// enough). "None" clears the bend so removal is panel-accessible, not undo-only — mirrors Slide.
function BendControl({ active, disabled }: { active: boolean; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <Toggle label="Bend ▾" active={active} disabled={disabled} onClick={() => setOpen((o) => !o)} />
      {open && !disabled && (
        <>
          <div style={backdropStyle} onClick={() => setOpen(false)} />
          <div style={popoverStyle}>
            <div style={popLabelStyle}>Bend</div>
            <PopItem
              label="None"
              active={!active}
              onClick={() => {
                clearSelectedBend()
                setOpen(false)
              }}
            />
            {BEND_PRESETS.map((p) => (
              <PopItem
                key={p.id}
                label={p.label}
                active={false}
                onClick={() => {
                  setSelectedBend(p)
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

// ── Whammy submenu (beat-level preset list + None) ───────────────────────────────────────────────
function WhammyControl({ active, disabled }: { active: boolean; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <Toggle label="Whammy ▾" active={active} disabled={disabled} onClick={() => setOpen((o) => !o)} />
      {open && !disabled && (
        <>
          <div style={backdropStyle} onClick={() => setOpen(false)} />
          <div style={popoverStyle}>
            <div style={popLabelStyle}>Tremolo bar</div>
            <PopItem
              label="None"
              active={!active}
              onClick={() => {
                clearSelectedWhammy()
                setOpen(false)
              }}
            />
            {WHAMMY_PRESETS.map((p) => (
              <PopItem
                key={p.id}
                label={p.label}
                active={false}
                onClick={() => {
                  setSelectedWhammy(p)
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

// ── Tremolo submenu (beat-level preset list + None) ──────────────────────────────────────────────
function TremoloControl({
  beat,
  active,
  disabled,
}: {
  beat: model.Beat | null
  active: boolean
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const speed = beat?.tremoloSpeed ?? null
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <Toggle label="Tremolo ▾" active={active} disabled={disabled} onClick={() => setOpen((o) => !o)} />
      {open && !disabled && (
        <>
          <div style={backdropStyle} onClick={() => setOpen(false)} />
          <div style={popoverStyle}>
            <div style={popLabelStyle}>Tremolo picking</div>
            <PopItem
              label="None"
              active={!active}
              onClick={() => {
                clearSelectedTremolo()
                setOpen(false)
              }}
            />
            {TREMOLO_PRESETS.map((p) => (
              <PopItem
                key={p.id}
                label={p.label}
                active={speed === p.speed}
                onClick={() => {
                  setSelectedTremolo(p)
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

// ── Harmonics submenu (note-level; Natural + Pinch, both verified harmonicValue 0) ───────────────
function HarmonicControl({
  note,
  active,
  disabled,
}: {
  note: model.Note | null
  active: boolean
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const type = note?.harmonicType ?? model.HarmonicType.None
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <Toggle label="Harmonic ▾" active={active} disabled={disabled} onClick={() => setOpen((o) => !o)} />
      {open && !disabled && (
        <>
          <div style={backdropStyle} onClick={() => setOpen(false)} />
          <div style={popoverStyle}>
            <div style={popLabelStyle}>Harmonic</div>
            {HARMONIC_OPTIONS.map((o) => (
              <PopItem
                key={o.value}
                label={o.label}
                active={type === o.value}
                onClick={() => {
                  setSelectedHarmonic(o.value)
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

// ── Grace submenu (note-level ACTION — inserts a grace beat before; no toggle state) ─────────────
// Grace is an insertion, not a property of the selected beat (the grace is its own beat), so there's
// no "active" highlight. Add-only via the panel in 4b-2 (remove with undo) — a scope choice, not a
// limitation; a "Remove grace" control is a clean follow-up (see InsertGraceBeatCommand's note).
function GraceControl({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <Toggle label="Grace ▾" active={false} disabled={disabled} onClick={() => setOpen((o) => !o)} />
      {open && !disabled && (
        <>
          <div style={backdropStyle} onClick={() => setOpen(false)} />
          <div style={popoverStyle}>
            <div style={popLabelStyle}>Add grace note</div>
            {GRACE_OPTIONS.map((o) => (
              <PopItem
                key={o.value}
                label={o.label}
                active={false}
                onClick={() => {
                  setSelectedGrace(o.value)
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

// ── Chord picker (beat-level; grouped by root note, "None" clears) ───────────────────────────────
// 4b-3's owner choice: a single scrollable popover with chords grouped under root-note headers
// (A, B, C…), reusing the existing popover/PopItem styling — no new dependency, scales to ~60. The
// library is already authored grouped by root, so first-appearance order gives the natural sequence.
function chordRoot(name: string): string {
  const second = name[1]
  return second === '#' || second === 'b' ? name.slice(0, 2) : name[0]
}
const CHORD_GROUPS: { root: string; defs: ChordDef[] }[] = (() => {
  const groups: { root: string; defs: ChordDef[] }[] = []
  for (const def of CHORD_LIBRARY) {
    const root = chordRoot(def.name)
    let g = groups.find((x) => x.root === root)
    if (!g) {
      g = { root, defs: [] }
      groups.push(g)
    }
    g.defs.push(def)
  }
  return groups
})()

function ChordControl({ chordId, disabled }: { chordId: string | null; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <Toggle
        label={`Chord${chordId ? `: ${chordId}` : ''} ▾`}
        active={!!chordId}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      />
      {open && !disabled && (
        <>
          <div style={backdropStyle} onClick={() => setOpen(false)} />
          <div style={chordPopoverStyle}>
            <PopItem
              label="None"
              active={!chordId}
              onClick={() => {
                clearSelectedChord()
                setOpen(false)
              }}
            />
            {CHORD_GROUPS.map((g) => (
              <div key={g.root}>
                <div style={popLabelStyle}>{g.root}</div>
                <div style={chordRowStyle}>
                  {g.defs.map((def) => (
                    <button
                      key={def.name}
                      type="button"
                      onClick={() => {
                        setSelectedChord(def)
                        setOpen(false)
                      }}
                      style={chordChipStyle(chordId === def.name)}
                    >
                      {def.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </span>
  )
}

// ── Bar / Measure controls (Phase 5a) ────────────────────────────────────────────────────────────
const TS_DENOMINATORS = [1, 2, 4, 8, 16, 32]

/** A number input that commits on Enter/blur (not per-keystroke, so a half-typed "1→12" doesn't fire
 *  two commands). Re-seeds its local text whenever the external `value` changes (selection moves) via
 *  the `key` the parent sets. Invalid/out-of-range or unchanged input reverts silently. */
function NumberCommit({
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  value: number
  min: number
  max: number
  disabled: boolean
  onCommit: (v: number) => void
}) {
  const [text, setText] = useState(String(value))
  const commit = () => {
    const v = Math.round(Number(text))
    if (Number.isFinite(v) && v >= min && v <= max && v !== value) onCommit(v)
    else setText(String(value))
  }
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={text}
      disabled={disabled}
      style={numInputStyle}
      onInput={(e) => setText((e.target as HTMLInputElement).value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

function TimeSigControl({ num, denom, disabled }: { num: number; denom: number; disabled: boolean }) {
  return (
    <span style={inlineControlStyle}>
      <span style={{ color: disabled ? '#bbb' : '#555' }}>Time</span>
      <NumberCommit
        key={`ts-num-${num}`}
        value={num}
        min={1}
        max={32}
        disabled={disabled}
        onCommit={(v) => setSelectedTimeSignature(v, denom)}
      />
      <span style={{ color: disabled ? '#bbb' : '#555' }}>/</span>
      <select
        value={denom}
        disabled={disabled}
        style={selectStyle}
        onChange={(e) => setSelectedTimeSignature(num, Number((e.target as HTMLSelectElement).value))}
      >
        {TS_DENOMINATORS.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </span>
  )
}

function KeySigControl({
  fifths,
  type,
  disabled,
}: {
  fifths: model.KeySignature
  type: model.KeySignatureType
  disabled: boolean
}) {
  const idx = KEY_SIGNATURE_OPTIONS.findIndex((o) => o.fifths === fifths && o.type === type)
  return (
    <span style={inlineControlStyle}>
      <span style={{ color: disabled ? '#bbb' : '#555' }}>Key</span>
      <select
        value={idx}
        disabled={disabled}
        style={selectStyle}
        onChange={(e) => {
          const o = KEY_SIGNATURE_OPTIONS[Number((e.target as HTMLSelectElement).value)]
          if (o) setSelectedKeySignature(o.fifths, o.type)
        }}
      >
        {KEY_SIGNATURE_OPTIONS.map((o, i) => (
          <option key={i} value={i}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  )
}

/** Tempo marker for the selected bar. Shows the bar's marker bpm if present, else `score.tempo` as a
 *  placeholder. Commits on Enter or the Set button. */
function TempoControl({
  value,
  placeholder,
  disabled,
}: {
  value: number | null
  placeholder: number
  disabled: boolean
}) {
  const [text, setText] = useState(value != null ? String(value) : '')
  const commit = () => {
    const v = Math.round(Number(text))
    if (Number.isFinite(v) && v > 0) setSelectedTempo(v)
  }
  return (
    <span style={inlineControlStyle}>
      <span style={{ color: disabled ? '#bbb' : '#555' }}>Tempo</span>
      <input
        type="number"
        min={1}
        value={text}
        placeholder={String(placeholder)}
        disabled={disabled}
        style={numInputStyle}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
      <button type="button" disabled={disabled || text === ''} onClick={commit} style={btnStyle(false, disabled || text === '')}>
        Set
      </button>
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

// ── Rhythm: clickable duration picker (the −/+ keys made visible) ────────────────────────────────
// Fraction labels (1, 1⁄2, … 1⁄32) instead of musical glyphs (𝅝 𝅗𝅥 …), which render inconsistently
// across system fonts. Order = longest→shortest, matching DURATION_LADDER. The active value is
// highlighted so a new user can see the current length and click another to change it.
const DURATION_BUTTONS: { value: model.Duration; label: string; title: string }[] = [
  { value: model.Duration.Whole, label: '1', title: 'Whole note' },
  { value: model.Duration.Half, label: '1⁄2', title: 'Half note' },
  { value: model.Duration.Quarter, label: '1⁄4', title: 'Quarter note' },
  { value: model.Duration.Eighth, label: '1⁄8', title: 'Eighth note' },
  { value: model.Duration.Sixteenth, label: '1⁄16', title: 'Sixteenth note' },
  { value: model.Duration.ThirtySecond, label: '1⁄32', title: 'Thirty-second note' },
]

function DurationButtons({ duration, disabled }: { duration: model.Duration | null; disabled: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: '0.2rem' }}>
      {DURATION_BUTTONS.map((d) => (
        <button
          key={d.value}
          type="button"
          title={d.title}
          disabled={disabled}
          onClick={() => setSelectedDuration(d.value)}
          style={btnStyle(duration === d.value, disabled)}
        >
          {d.label}
        </button>
      ))}
    </span>
  )
}

// ── Note: clickable fret pad (the 0–9 keys made visible) ─────────────────────────────────────────
// A 0–24 grid popover, the mouse path to fret entry. The trigger shows the selected note's current
// fret (or — for an empty string). Clicking a cell sets the fret, adding a note if the string is
// empty — same routing as the keyboard, via setSelectedFret.
function FretControl({ fret, disabled }: { fret: number | null; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <Toggle
        label={`Fret: ${fret ?? '—'} ▾`}
        active={fret != null}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      />
      {open && !disabled && (
        <>
          <div style={backdropStyle} onClick={() => setOpen(false)} />
          <div style={fretPopoverStyle}>
            <div style={popLabelStyle}>Fret (sets the selected string)</div>
            <div style={fretGridStyle}>
              {Array.from({ length: MAX_FRET + 1 }, (_, n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setSelectedFret(n)
                    setOpen(false)
                  }}
                  style={fretCellStyle(fret === n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
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

const inlineControlStyle = { display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }
const numInputStyle = {
  width: 46,
  fontSize: '0.78rem',
  padding: '2px 4px',
  borderRadius: 4,
  border: '1px solid #ccc',
}
const selectStyle = {
  fontSize: '0.78rem',
  padding: '2px 4px',
  borderRadius: 4,
  border: '1px solid #ccc',
  background: '#fff',
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
// Chord popover is taller (grouped by root) → cap height and scroll; chords sit in wrap rows.
const chordPopoverStyle = {
  ...popoverStyle,
  maxHeight: 320,
  overflowY: 'auto' as const,
  minWidth: 200,
}
// Fret pad: a fixed-width grid of small cells (0–24). 6 columns keeps it compact and roughly square.
const fretPopoverStyle = {
  ...popoverStyle,
  minWidth: 0,
}
const fretGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(6, 1fr)',
  gap: 3,
  padding: '0 4px 4px',
}
function fretCellStyle(active: boolean) {
  return {
    width: 28,
    fontSize: '0.78rem',
    padding: '3px 0',
    textAlign: 'center' as const,
    borderRadius: 4,
    cursor: 'pointer',
    border: `1px solid ${active ? '#5a6ee0' : '#ddd'}`,
    background: active ? '#5a6ee0' : '#fafafa',
    color: active ? '#fff' : '#333',
    fontWeight: active ? 600 : 400,
    fontVariantNumeric: 'tabular-nums' as const,
  }
}
const chordRowStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  gap: 3,
  padding: '0 4px 4px',
}
function chordChipStyle(active: boolean) {
  return {
    fontSize: '0.74rem',
    padding: '2px 7px',
    borderRadius: 4,
    cursor: 'pointer',
    border: `1px solid ${active ? '#5a6ee0' : '#ddd'}`,
    background: active ? '#5a6ee0' : '#fafafa',
    color: active ? '#fff' : '#333',
    fontWeight: active ? 600 : 400,
  }
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
