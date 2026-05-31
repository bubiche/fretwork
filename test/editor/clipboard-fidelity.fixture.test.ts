import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Settings, model, importer, exporter } from '@coderline/alphatab'
import { PasteCommand } from '../../src/editor/commands'
import { resolveVoice, type BeatRef } from '../../src/editor/selection'
import { makeMinimalScore } from '../fixtures/makeMinimalScore'

/**
 * PASTE FIDELITY — NOT the snapshot round-trip test, by design. The property round-trip
 * cannot prove paste fidelity: it can't author a cross-position
 * paste, and its field set is the very thing we route around (a snapshot-based serializer would drop
 * any effect the snapshot doesn't enumerate). So we prove paste a different way:
 *
 *   (1) in-app visual sign-off (manual — paste a riff carrying bends/whammy/harmonics/a chord and
 *       confirm it renders at the destination), and
 *   (2) THIS field-diff: simulate the real copy→paste path (GP7 export → re-import → splice the
 *       cloned beats into a target voice via PasteCommand → finish) and assert the pasted beats'
 *       effect fields equal the source region's, walked point-by-point.
 *
 * ⚠ Do NOT "trust the green" of the snapshot property test for paste — it does not cover this path.
 *
 * ⚠ Bend points are asserted RAW (the GP7 round-trip is lossless for bends — verified). Whammy points
 * are asserted NORMALIZED: the GP7 importer inserts a one-time, benign duplicate interior point
 * (`[…,[45,-10],[60,-10]]` → `[…,[45,-10],[45,-10],[60,-10]]`) — identical curve, stable (does not
 * compound). Comparing raw would spuriously fail; we de-duplicate consecutive identical points first.
 */
const fixturePath = fileURLToPath(new URL('../fixtures/sample_whammy_dive_full_bend.gp4', import.meta.url))

function load(bytes: Uint8Array): model.Score {
  const s = importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings())
  s.finish(new Settings())
  return s
}

type Pt = [number, number]
const points = (ps: model.BendPoint[] | null): Pt[] | null => (ps ? ps.map((p) => [p.offset, p.value]) : null)
/** Collapse consecutive identical points (the GP7 whammy duplicate). */
function dedupe(ps: Pt[] | null): Pt[] | null {
  if (!ps) return ps
  return ps.filter((p, i) => i === 0 || p[0] !== ps[i - 1][0] || p[1] !== ps[i - 1][1])
}

/** Flatten track 0 / staff 0 / voice 0 beats in order. */
function flatBeats(score: model.Score): model.Beat[] {
  const out: model.Beat[] = []
  for (const bar of score.tracks[0].staves[0].bars) for (const b of bar.voices[0].beats) out.push(b)
  return out
}

describe('paste fidelity (GP7 clone → PasteCommand splice → finish), field-diff vs source', () => {
  it('preserves frets, harmonics, bend points (raw) and whammy points (normalized)', () => {
    const original = load(new Uint8Array(readFileSync(fixturePath)))
    const sourceBeats = flatBeats(original)

    // Simulate copy (export whole score) then paste (re-import → cloned, independent beats).
    const bytes = new exporter.Gp7Exporter().export(original, new Settings())
    const clone = load(bytes)
    const clonedBeats = flatBeats(clone)
    expect(clonedBeats.length).toBe(sourceBeats.length) // beat count survives the round-trip

    // Paste all the cloned beats into a fresh 6-string target via the real PasteCommand, then finish.
    const target = makeMinimalScore({ bars: 1, beatsPerBar: 1, strings: 6 })
    const at: BeatRef = { trackIndex: 0, staffIndex: 0, voiceIndex: 0, barIndex: 0, beatIndex: 0 }
    new PasteCommand(at, clonedBeats, new Map()).apply(target)
    target.finish(new Settings())

    const pasted = resolveVoice(target, at)!.beats.slice(1) // drop the target's own seed beat at index 0
    expect(pasted.length).toBe(sourceBeats.length)

    let bendsChecked = 0
    let whammiesChecked = 0
    for (let i = 0; i < sourceBeats.length; i++) {
      const src = sourceBeats[i]
      const dst = pasted[i]

      // Beat-level whammy — NORMALIZED (GP7 inserts a benign duplicate point).
      expect(dst.whammyBarType).toBe(src.whammyBarType)
      expect(dedupe(points(dst.whammyBarPoints))).toEqual(dedupe(points(src.whammyBarPoints)))
      if (src.hasWhammyBar) whammiesChecked++

      // Note-level: frets, harmonics, and bend points RAW (bends are lossless through GP7).
      const srcNotes = [...src.notes].sort((a, b) => a.string - b.string)
      const dstNotes = [...dst.notes].sort((a, b) => a.string - b.string)
      expect(dstNotes.map((n) => [n.string, n.fret])).toEqual(srcNotes.map((n) => [n.string, n.fret]))
      expect(dstNotes.map((n) => [n.harmonicType, n.harmonicValue])).toEqual(
        srcNotes.map((n) => [n.harmonicType, n.harmonicValue]),
      )
      for (let k = 0; k < srcNotes.length; k++) {
        expect(dstNotes[k].bendType).toBe(srcNotes[k].bendType)
        expect(points(dstNotes[k].bendPoints)).toEqual(points(srcNotes[k].bendPoints)) // RAW
        if (srcNotes[k].hasBend) bendsChecked++
      }
    }
    // Guard against a vacuous pass — the fixture must actually carry the effects we claim to verify.
    expect(bendsChecked).toBeGreaterThan(0)
    expect(whammiesChecked).toBeGreaterThan(0)
  })
})
