import { useEffect, useState } from 'preact/hooks'
import {
  resolveBeat,
  sameVoice,
  normalizeRange,
  collectRangeBeats,
  openStringLabel,
} from '../editor/selection'
import { useStore } from './hooks/useStore'

type Rect = { x: number; y: number; w: number; h: number }

export function SelectionOverlay() {
  const selection = useStore((s) => s.selection)
  const anchor = useStore((s) => s.anchor)
  const selectedString = useStore((s) => s.selectedString)
  const api = useStore((s) => s.api)
  const [, bumpTick] = useState(0)

  useEffect(() => {
    if (!api) return
    const bump = () => bumpTick((n) => n + 1)
    api.renderFinished.on(bump)
    return () => api.renderFinished.off(bump)
  }, [api])

  if (!api || !selection) return null
  const lookup = api.boundsLookup
  const score = api.score
  if (!lookup || !score) return null

  // Range selection: when an anchor is set, draw a box per beat from anchor→focus (owner
  // decision: per-beat boxes, not one sweep). Reuses the same union-of-staff-bounds geometry as the
  // single-beat box below, applied to each beat in the range.
  if (anchor && sameVoice(anchor, selection)) {
    const range = normalizeRange(anchor, selection)
    // Only draw range boxes for a genuine multi-beat span. A zero-length range (Shift+click the
    // already-selected beat, or Shift+arrow refused at the score boundary) falls through to the
    // single-beat highlight below so the per-string fret cursor isn't lost.
    if (range && !(range.fromBar === range.toBar && range.fromBeat === range.toBeat)) {
      const beats = collectRangeBeats(score, range)
      return (
        <>
          {beats.map((b, i) => {
            const bounds = lookup.findBeats(b)
            if (!bounds || bounds.length === 0) return null
            const box = unionRect(bounds.map((x) => x.visualBounds))
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: box.x,
                  top: box.y,
                  width: box.w,
                  height: box.h,
                  background: 'rgba(50, 120, 255, 0.18)',
                  border: '1px solid rgba(50, 120, 255, 0.45)',
                  borderRadius: 2,
                  pointerEvents: 'none',
                }}
              />
            )
          })}
        </>
      )
    }
  }

  const beat = resolveBeat(score, selection)
  if (!beat) return null

  // alphaTab renders the SAME beat once per staff (standard notation + tablature), and each renderer
  // registers its own BeatBounds. `findBeats` returns them all; `findBeat` returns only the first =
  // the notation staff, whose note bounds are placed by PITCH (up on the 5-line staff) — useless for
  // anchoring a string highlight. We want the tablature staff, whose note bounds are the fret digits
  // placed by STRING. The tab staff renders below the notation staff, so it's the entry with the
  // largest y. (Whole staves don't overlap vertically, so this max-y pick is unambiguous — unlike
  // comparing individual note heads, which interleave by pitch within one staff.)
  const allBounds = lookup.findBeats(beat)
  if (!allBounds || allBounds.length === 0) return null
  let tabBounds = allBounds[0]
  for (const b of allBounds) if (b.visualBounds.y > tabBounds.visualBounds.y) tabBounds = b

  // Outer beat box: union of every staff's beat bounds → the whole beat column across both staves.
  // A union needs no top/bottom assumption, so only the note-row pick below leans on the max-y staff.
  const box = unionRect(allBounds.map((b) => b.visualBounds))

  // Per-string fret-digit rectangles on the tab staff (requires core.includeNoteBounds).
  const rows = stringRows(tabBounds.notes)
  const noteBounds = rows.get(selectedString) ?? null

  // When the selected string carries no note (building a chord or moving to a fresh string) there's
  // no fret digit to anchor to. Interpolate the target row from the other digits: tab lines are
  // evenly spaced, so string→y is linear. ≥2 strings → exact spacing; 1 → approximate by digit
  // height.
  const ghostRow = noteBounds ? null : interpolateRow(rows, selectedString)

  // A fully-empty beat (rest, no digits at all — the opening state of every blank tab) has nothing
  // to interpolate from, so neither cue above can place a row. Fall back to a label badge that NAMES
  // the target string (number + open-note) on the beat box. It anchors to `box` (no tab-line geometry
  // to guess at), and naming the string is clearer here than pointing at a line on an empty staff.
  const showBadge = !noteBounds && !ghostRow
  const badge = showBadge ? openStringLabel(beat.voice.bar.staff.tuning, selectedString) : null

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          background: 'rgba(50, 120, 255, 0.10)',
          border: '1px solid rgba(50, 120, 255, 0.45)',
          borderRadius: 2,
          pointerEvents: 'none',
        }}
      />
      {noteBounds && (
        <div
          style={{
            position: 'absolute',
            left: noteBounds.x - 2,
            top: noteBounds.y - 2,
            width: noteBounds.w + 4,
            height: noteBounds.h + 4,
            background: 'rgba(50, 120, 255, 0.35)',
            borderRadius: 2,
            pointerEvents: 'none',
          }}
        />
      )}
      {ghostRow && (
        // Dashed + fainter than the occupied highlight so it reads as "fret lands here (empty)".
        <div
          style={{
            position: 'absolute',
            left: ghostRow.x - 2,
            top: ghostRow.y - 2,
            width: ghostRow.w + 4,
            height: ghostRow.h + 4,
            background: 'rgba(50, 120, 255, 0.12)',
            border: '1px dashed rgba(50, 120, 255, 0.7)',
            borderRadius: 2,
            pointerEvents: 'none',
          }}
        />
      )}
      {badge && (
        // Inset into the box's top-left (not floating above it): the blank-tab target is beat 0 of
        // the first, topmost bar, so anchoring above the box would clip off the top of the score.
        <div
          style={{
            position: 'absolute',
            left: box.x + 1,
            top: box.y + 1,
            background: 'rgba(50, 120, 255, 0.9)',
            color: '#fff',
            fontSize: 10,
            lineHeight: 1.3,
            padding: '0 4px',
            borderRadius: 3,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {badge}
        </div>
      )}
    </>
  )
}

type NoteBoundsLike = {
  note: { string: number }
  noteHeadBounds: Rect
}

/** Smallest rectangle containing all the given rectangles. */
function unionRect(rects: Rect[]): Rect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * Map each string to its fret-digit rectangle. These come from a single (tab) staff's BeatBounds, so
 * there's exactly one entry per note — keyed directly by string, no per-string disambiguation needed.
 */
function stringRows(notes: NoteBoundsLike[] | null): Map<number, Rect> {
  const byString = new Map<number, Rect>()
  if (!notes) return byString
  for (const n of notes) byString.set(n.note.string, n.noteHeadBounds)
  return byString
}

/**
 * Estimate the screen rectangle for `targetString`'s tab row from the other fret digits in the beat.
 * Returns null when there's nothing to anchor to. Centers are used so the box lands on the line, and
 * we extrapolate linearly — correct for tab staves, whose lines are evenly spaced.
 */
function interpolateRow(rows: Map<number, Rect>, targetString: number): Rect | null {
  const entries = [...rows.entries()] // [string, rect]
  if (entries.length === 0) return null

  const [refString, ref] = entries[0]
  const refCenter = ref.y + ref.h / 2

  // Pixels of vertical travel per +1 string. Higher string index renders higher up (smaller y).
  let spacingPerStep: number
  if (entries.length >= 2) {
    let lo = entries[0]
    let hi = entries[0]
    for (const e of entries) {
      if (e[0] < lo[0]) lo = e
      if (e[0] > hi[0]) hi = e
    }
    const span = hi[0] - lo[0]
    const yLo = lo[1].y + lo[1].h / 2
    const yHi = hi[1].y + hi[1].h / 2
    spacingPerStep = span === 0 ? ref.h : (yLo - yHi) / span
  } else {
    spacingPerStep = ref.h
  }

  const targetCenter = refCenter - (targetString - refString) * spacingPerStep
  return { x: ref.x, y: targetCenter - ref.h / 2, w: ref.w, h: ref.h }
}
