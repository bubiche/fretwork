import type { model } from '@coderline/alphatab'

/**
 * A JSON-able tree of only the fields v1 can touch. Cheap, deterministic, no exporter
 * dependency. It is NOT a full-fidelity dump — Phase 6's GP7 round-trip owns that. This is
 * for *editor invariants*: capture exactly what a Command can mutate, so an apply/undo
 * round-trip can be proven equal by `toEqual`. The shape grows as later phases add effects
 * (bend points, slide flags, palm-mute, …) — see PHASE_2.md.
 *
 * Deliberately omits regenerating IDs and computed/derived geometry (display bounds, parent
 * backrefs), which would make the snapshot non-deterministic and break stable-read equality.
 */
export type ScoreSnapshot = {
  title: string
  tracks: TrackSnapshot[]
}

type TrackSnapshot = {
  name: string
  bars: BarSnapshot[]
}

type BarSnapshot = {
  voices: VoiceSnapshot[]
}

type VoiceSnapshot = {
  beats: BeatSnapshot[]
}

type BeatSnapshot = {
  duration: number // alphaTab Duration enum value
  dots: number // ChangeDuration toggles beat.dots (0 ↔ 1)
  notes: NoteSnapshot[]
  // ── Phase 4 effect fields (beat-level) ────────────────────────────────────────────────────
  // Settable fields only — never derived pointers/spans. Enums captured as their numeric value.
  dynamics: number // DynamicValue
  whammyBarType: number // WhammyType
  whammyBarPoints: BendPointSnapshot[] | null
  tap: boolean
  graceType: number // GraceType
  chordId: string | null
  tremoloSpeed: number | null // Duration | null (deprecated setter, but the stable read path)
}

type NoteSnapshot = {
  string: number
  fret: number
  // ── Phase 4 effect fields (note-level) ────────────────────────────────────────────────────
  isPalmMute: boolean
  isGhost: boolean
  isDead: boolean
  isStaccato: boolean
  vibrato: number // VibratoType
  isLetRing: boolean
  isHammerPullOrigin: boolean
  slideInType: number // SlideInType
  slideOutType: number // SlideOutType
  isTieDestination: boolean
  harmonicType: number // HarmonicType
  harmonicValue: number
  dynamics: number // DynamicValue
  bendType: number // BendType
  bendPoints: BendPointSnapshot[] | null
}

/** A bend/whammy curve point reduced to its two settable coordinates (see the curve recipes in
 *  PHASE_4: offset 0–60, value in quarter-tones). Order is preserved as authored — NOT sorted,
 *  because finish() may reorder/collapse points and the editor state is the pre-finish array. */
type BendPointSnapshot = { offset: number; value: number }

/** Reduce a bend/whammy point array to plain `{offset, value}` records (or null). Preserves order. */
function bendPoints(points: model.BendPoint[] | null): BendPointSnapshot[] | null {
  return points ? points.map((p) => ({ offset: p.offset, value: p.value })) : null
}

export function scoreSnapshot(score: model.Score): ScoreSnapshot {
  return {
    title: score.title,
    tracks: score.tracks.map((track) => ({
      name: track.name,
      // v1 only touches staff 0 (BeatRef.staffIndex is always 0). The snapshot mirrors that
      // scope; multi-staff fidelity isn't an editor invariant this phase needs to protect.
      bars: (track.staves[0]?.bars ?? []).map((bar) => ({
        voices: bar.voices.map((voice) => ({
          beats: voice.beats.map((beat) => ({
            duration: beat.duration,
            dots: beat.dots,
            dynamics: beat.dynamics,
            whammyBarType: beat.whammyBarType,
            whammyBarPoints: bendPoints(beat.whammyBarPoints),
            tap: beat.tap,
            graceType: beat.graceType,
            chordId: beat.chordId,
            tremoloSpeed: beat.tremoloSpeed,
            // Sort by string so undo-via-addNote (which appends) is snapshot-equal to the
            // original regardless of array order. removeNote splices without reindexing and
            // addNote appends, so a positional compare would spuriously fail across the whole
            // note-command family; normalizing here kills that bug class (see PHASE_3 Decisions).
            notes: beat.notes
              .map((note) => ({
                string: note.string,
                fret: note.fret,
                isPalmMute: note.isPalmMute,
                isGhost: note.isGhost,
                isDead: note.isDead,
                isStaccato: note.isStaccato,
                vibrato: note.vibrato,
                isLetRing: note.isLetRing,
                isHammerPullOrigin: note.isHammerPullOrigin,
                slideInType: note.slideInType,
                slideOutType: note.slideOutType,
                isTieDestination: note.isTieDestination,
                harmonicType: note.harmonicType,
                harmonicValue: note.harmonicValue,
                dynamics: note.dynamics,
                bendType: note.bendType,
                bendPoints: bendPoints(note.bendPoints),
              }))
              .sort((a, b) => a.string - b.string),
          })),
        })),
      })),
    })),
  }
}
