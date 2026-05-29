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
  notes: NoteSnapshot[]
}

type NoteSnapshot = {
  string: number
  fret: number
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
            notes: beat.notes.map((note) => ({
              string: note.string,
              fret: note.fret,
            })),
          })),
        })),
      })),
    })),
  }
}
