import { describe, it, expect, beforeEach } from 'vitest'
import { model } from '@coderline/alphatab'
import { InsertBeatCommand, insertBeatAfterSelection } from '../../../src/editor/commands'
import { clearHistory, undo } from '../../../src/editor/HistoryRouter'
import { scoreSnapshot } from '../../../src/editor/snapshot'
import { resolveVoice } from '../../../src/editor/selection'
import { store } from '../../../src/editor/store'
import type { BeatRef } from '../../../src/editor/selection'
import { makeMinimalScore } from '../../fixtures/makeMinimalScore'
import type { AlphaTabApi } from '@coderline/alphatab'

const ref = (barIndex: number, beatIndex: number): BeatRef => ({
  trackIndex: 0,
  staffIndex: 0,
  voiceIndex: 0,
  barIndex,
  beatIndex,
})

describe('InsertBeatCommand (pure apply/undo)', () => {
  it('inserts an empty quarter rest after the target; undo removes it', () => {
    const score = makeMinimalScore({ beatsPerBar: 3 })
    const original = scoreSnapshot(score)
    const voice = resolveVoice(score, ref(0, 0))!
    expect(voice.beats).toHaveLength(3)

    const cmd = new InsertBeatCommand(ref(0, 1))
    cmd.apply(score)
    expect(voice.beats).toHaveLength(4)
    expect(voice.beats[2].duration).toBe(model.Duration.Quarter) // inserted after index 1
    expect(voice.beats[2].dots).toBe(0)
    expect(voice.beats[2].notes).toHaveLength(0) // empty rest
    expect(voice.beats[2].voice).toBe(voice) // backref set (Beat.finish needs it)
    expect(cmd.relayout).toBe('voice')

    cmd.undo(score)
    expect(voice.beats).toHaveLength(3)
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('inserts at the front when the inserted-after beat is index 0', () => {
    const score = makeMinimalScore({ beatsPerBar: 2 })
    const voice = resolveVoice(score, ref(0, 0))!
    const cmd = new InsertBeatCommand(ref(0, 0))
    cmd.apply(score)
    expect(voice.beats).toHaveLength(3)
    expect(voice.beats[1].notes).toHaveLength(0) // inserted at index 1 (after 0)
  })
})

describe('insertBeatAfterSelection (dispatcher)', () => {
  let score: ReturnType<typeof makeMinimalScore>

  beforeEach(() => {
    clearHistory()
    score = makeMinimalScore({ beatsPerBar: 3 })
    store.setState({
      api: { score, render() {} } as unknown as AlphaTabApi,
      selection: ref(0, 1),
      selectedString: 1,
      canUndo: false,
      canRedo: false,
    })
  })

  it('moves the selection onto the newly inserted beat', () => {
    insertBeatAfterSelection()
    expect(resolveVoice(score, ref(0, 0))!.beats).toHaveLength(4)
    expect(store.getState().selection!.beatIndex).toBe(2) // was 1, now on the new beat
  })

  it('undo removes the beat and re-validates the selection', () => {
    insertBeatAfterSelection()
    undo()
    expect(resolveVoice(score, ref(0, 0))!.beats).toHaveLength(3)
    // selection clamps back to a valid beat (beatIndex 2 still valid in a 3-beat bar)
    expect(store.getState().selection!.beatIndex).toBeLessThan(3)
  })
})
