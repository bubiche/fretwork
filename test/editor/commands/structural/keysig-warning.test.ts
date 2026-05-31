import { describe, it, expect, beforeEach } from 'vitest'
import { model, type AlphaTabApi } from '@coderline/alphatab'
import { setSelectedKeySignature } from '../../../../src/editor/commands/structural/SetKeySignature'
import { store } from '../../../../src/editor/store'
import { clearHistory } from '../../../../src/editor/HistoryRouter'
import type { BeatRef } from '../../../../src/editor/selection'

/**
 * Phase 6 Q13 safety: a key signature set on a NON-track-0 staff is dropped on GP7 save/export (GP
 * keeps one key sig per bar, the first track's). Since auto-save persists every edit, that loss would
 * be silent on the next reload — so the dispatcher raises a non-blocking `warning`. This pins it.
 */
function twoTrackScore(): model.Score {
  const score = new model.Score()
  for (let t = 0; t < 2; t++) {
    const track = new model.Track()
    score.addTrack(track)
    const staff = new model.Staff()
    track.addStaff(staff)
    staff.stringTuning = new model.Tuning('t', [64, 59, 55, 50, 45, 40], false)
  }
  score.addMasterBar(new model.MasterBar())
  for (let t = 0; t < 2; t++) {
    const bar = new model.Bar()
    score.tracks[t].staves[0].addBar(bar)
    const v = new model.Voice()
    bar.addVoice(v)
    const beat = new model.Beat()
    beat.duration = model.Duration.Quarter
    v.addBeat(beat)
    const n = new model.Note()
    n.string = 1
    n.fret = 0
    beat.addNote(n)
  }
  return score
}

const at = (trackIndex: number): BeatRef => ({ trackIndex, staffIndex: 0, voiceIndex: 0, barIndex: 0, beatIndex: 0 })

describe('setSelectedKeySignature warning (non-track-0 won\'t persist)', () => {
  beforeEach(() => {
    clearHistory()
    const score = twoTrackScore()
    // Settings-less fake api (skips finish() in afterMutation; the model write still runs).
    store.setState({
      api: { score, render() {} } as unknown as AlphaTabApi,
      selection: at(0),
      warning: null,
      canUndo: false,
      canRedo: false,
    })
  })

  it('warns when set on a non-track-0 track', () => {
    store.setState({ selection: at(1) })
    setSelectedKeySignature(model.KeySignature.A, model.KeySignatureType.Major)
    expect(store.getState().warning).toMatch(/won't be saved/)
  })

  it('clears the warning when set on track 0', () => {
    store.setState({ selection: at(1) })
    setSelectedKeySignature(model.KeySignature.A, model.KeySignatureType.Major)
    expect(store.getState().warning).toBeTruthy()

    store.setState({ selection: at(0) })
    setSelectedKeySignature(model.KeySignature.D, model.KeySignatureType.Major)
    expect(store.getState().warning).toBeNull()
  })
})
