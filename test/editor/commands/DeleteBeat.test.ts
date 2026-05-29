import { describe, it, expect, beforeEach } from 'vitest'
import { DeleteBeatCommand, deleteSelectedBeat } from '../../../src/editor/commands'
import { clearHistory, undo } from '../../../src/editor/HistoryRouter'
import { scoreSnapshot } from '../../../src/editor/snapshot'
import { resolveVoice, resolveBeat } from '../../../src/editor/selection'
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

describe('DeleteBeatCommand (pure apply/undo)', () => {
  it('removes the beat; undo re-inserts the same object at its index', () => {
    const score = makeMinimalScore({ beatsPerBar: 3 })
    const original = scoreSnapshot(score)
    const voice = resolveVoice(score, ref(0, 1))!
    const target = voice.beats[1]

    const cmd = new DeleteBeatCommand(ref(0, 1))
    cmd.apply(score)
    expect(voice.beats).toHaveLength(2)
    expect(voice.beats.indexOf(target)).toBe(-1)

    cmd.undo(score)
    expect(voice.beats).toHaveLength(3)
    expect(voice.beats[1]).toBe(target) // same object, original position
    expect(scoreSnapshot(score)).toEqual(original)
  })

  it('handles deleting index 0 (front) and restoring it', () => {
    const score = makeMinimalScore({ beatsPerBar: 3 })
    const original = scoreSnapshot(score)
    const voice = resolveVoice(score, ref(0, 0))!
    const first = voice.beats[0]

    const cmd = new DeleteBeatCommand(ref(0, 0))
    cmd.apply(score)
    expect(voice.beats[0]).not.toBe(first)
    cmd.undo(score)
    expect(voice.beats[0]).toBe(first) // splice(0,0,…) restores the front beat
    expect(scoreSnapshot(score)).toEqual(original)
  })
})

describe('deleteSelectedBeat (dispatcher)', () => {
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

  it('deletes the selected beat and lands the selection on a valid neighbor', () => {
    deleteSelectedBeat()
    expect(resolveVoice(score, ref(0, 0))!.beats).toHaveLength(2)
    expect(store.getState().selection!.beatIndex).toBeLessThan(2)
  })

  it('deleting the last beat clamps the selection to the new last beat', () => {
    store.setState({ selection: ref(0, 2) }) // last of 3
    deleteSelectedBeat()
    const voice = resolveVoice(score, ref(0, 0))!
    expect(voice.beats).toHaveLength(2)
    expect(store.getState().selection!.beatIndex).toBe(1) // clamped from 2 → 1 (new last)
  })

  it('the only beat in a voice collapses to a rest instead of deleting', () => {
    const single = makeMinimalScore({ beatsPerBar: 1 })
    store.setState({
      api: { score: single, render() {} } as unknown as AlphaTabApi,
      selection: ref(0, 0),
    })
    deleteSelectedBeat()
    const voice = resolveVoice(single, ref(0, 0))!
    expect(voice.beats).toHaveLength(1) // NOT deleted
    expect(voice.beats[0].isRest).toBe(true) // collapsed to a rest
  })
})
