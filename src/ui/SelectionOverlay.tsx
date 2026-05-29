import { useEffect, useState } from 'preact/hooks'
import { resolveBeat } from '../editor/selection'
import { useStore } from './hooks/useStore'

export function SelectionOverlay() {
  const selection = useStore((s) => s.selection)
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

  const beat = resolveBeat(score, selection)
  if (!beat) return null
  const bounds = lookup.findBeat(beat)
  if (!bounds) return null
  const { x, y, w, h } = bounds.visualBounds

  // Anchor the per-string highlight to the actual rendered note head (requires
  // core.includeNoteBounds). Deriving string rows from the beat's height is wrong — that height
  // spans both the notation and tab staves. When the selected string carries no note there's no
  // note head to anchor to, so we show only the beat box (empty-string targeting feedback is
  // deferred; alphaTab doesn't expose tab-line geometry cheaply).
  const noteBounds =
    bounds.notes?.find((n) => n.note.string === selectedString)?.noteHeadBounds ?? null

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width: w,
          height: h,
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
    </>
  )
}
