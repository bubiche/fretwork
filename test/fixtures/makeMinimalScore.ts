import { model } from '@coderline/alphatab'

export type MinimalScoreOptions = {
  /** Number of bars in the single track's single staff. Default 1. */
  bars?: number
  /** Beats per bar (same for every bar). Default 1. */
  beatsPerBar?: number
  /** Number of strings (tuning length); each beat gets a note on every string. Default 6. */
  strings?: number
  /** Song title. Default 'Test'. */
  title?: string
}

/**
 * Synthesises an in-memory alphaTab Score entirely in JS — no `.gp` fixture, no importer, no
 * `score.finish()`. The model's `add*` methods (addTrack/addStaff/addBar/addVoice/addBeat/
 * addNote) set the parent backrefs and zero-based indices that `resolveBeat`/`resolveNote` and
 * `beatRefFromBeat` rely on, which is all the editor code reads. Standard 6-string tuning.
 *
 * Frets are seeded distinctly (`barIndex*100 + beatIndex*10 + string`) so a snapshot can detect
 * a mutation at any position rather than aliasing two beats to the same value.
 */
export function makeMinimalScore(options: MinimalScoreOptions = {}): model.Score {
  const { bars = 1, beatsPerBar = 1, strings = 6, title = 'Test' } = options

  const score = new model.Score()
  score.title = title

  const track = new model.Track()
  track.name = 'Guitar'
  score.addTrack(track)

  const staff = new model.Staff()
  track.addStaff(staff)
  // Standard guitar tuning (high-E first per alphaTab's top-line convention); length drives
  // `staff.tuning.length`, which `moveString` clamps against.
  const standard = [64, 59, 55, 50, 45, 40]
  const tuning = standard.slice(0, strings)
  staff.stringTuning = new model.Tuning('Test Tuning', tuning, false)

  for (let b = 0; b < bars; b++) {
    score.addMasterBar(new model.MasterBar())

    const bar = new model.Bar()
    staff.addBar(bar)

    const voice = new model.Voice()
    bar.addVoice(voice)

    for (let i = 0; i < beatsPerBar; i++) {
      const beat = new model.Beat()
      beat.duration = model.Duration.Quarter
      voice.addBeat(beat)

      for (let s = 1; s <= strings; s++) {
        const note = new model.Note()
        note.string = s
        note.fret = b * 100 + i * 10 + s
        beat.addNote(note)
      }
    }
  }

  return score
}
