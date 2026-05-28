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

  const staff = score.tracks[selection.trackIndex]?.staves[selection.staffIndex]
  const stringCount = staff?.tuning.length ?? 0
  const rowH = stringCount > 0 ? h / stringCount : 0
  // String 1 = bottom; string N sits at offset (count - N) * rowH from top of bounds.
  const stripeY = y + (stringCount - selectedString) * rowH

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
      {stringCount > 0 && (
        <div
          style={{
            position: 'absolute',
            left: x,
            top: stripeY,
            width: w,
            height: rowH,
            background: 'rgba(50, 120, 255, 0.35)',
            pointerEvents: 'none',
          }}
        />
      )}
    </>
  )
}
