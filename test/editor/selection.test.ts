import { describe, it, expect, beforeEach } from 'vitest'
import { store } from '../../src/editor/store'
import { moveBeat, moveString, type BeatRef } from '../../src/editor/selection'
import { makeMinimalScore } from '../fixtures/makeMinimalScore'
import type { AlphaTabApi } from '@coderline/alphatab'

// 2 bars × 2 beats so wrap-at-bar-boundary has somewhere to wrap to. 6 strings for clamp math.
const score = makeMinimalScore({ bars: 2, beatsPerBar: 2, strings: 6 })

const ref = (barIndex: number, beatIndex: number): BeatRef => ({
  trackIndex: 0,
  staffIndex: 0,
  voiceIndex: 0,
  barIndex,
  beatIndex,
})

// moveBeat reads the live Score off store.api.score; a bare object with `.score` is enough.
// A default selection is needed because moveString also early-returns without one.
beforeEach(() => {
  store.setState({
    api: { score } as unknown as AlphaTabApi,
    selection: ref(0, 0),
    selectedString: 1,
  })
})

describe('moveBeat', () => {
  it('advances within a bar', () => {
    store.setState({ selection: ref(0, 0) })
    moveBeat(1)
    expect(store.getState().selection).toEqual(ref(0, 1))
  })

  it('retreats within a bar', () => {
    store.setState({ selection: ref(0, 1) })
    moveBeat(-1)
    expect(store.getState().selection).toEqual(ref(0, 0))
  })

  it('wraps forward across a bar boundary to beat 0 of the next bar', () => {
    store.setState({ selection: ref(0, 1) }) // last beat of bar 0
    moveBeat(1)
    expect(store.getState().selection).toEqual(ref(1, 0))
  })

  it('wraps backward across a bar boundary to the last beat of the previous bar', () => {
    store.setState({ selection: ref(1, 0) }) // first beat of bar 1
    moveBeat(-1)
    expect(store.getState().selection).toEqual(ref(0, 1))
  })

  it('is a no-op past the last beat of the last bar', () => {
    store.setState({ selection: ref(1, 1) }) // last beat of last bar
    moveBeat(1)
    expect(store.getState().selection).toEqual(ref(1, 1))
  })

  it('is a no-op before the first beat of the first bar', () => {
    store.setState({ selection: ref(0, 0) })
    moveBeat(-1)
    expect(store.getState().selection).toEqual(ref(0, 0))
  })

  it('does nothing without a selection', () => {
    store.setState({ selection: null })
    moveBeat(1)
    expect(store.getState().selection).toBeNull()
  })
})

describe('moveString', () => {
  // dy = -1 (arrow up) → visually up → higher pitch → higher alphaTab string index.
  it('arrow up (dy -1) increases the string index', () => {
    store.setState({ selectedString: 3 })
    moveString(-1)
    expect(store.getState().selectedString).toBe(4)
  })

  it('arrow down (dy +1) decreases the string index', () => {
    store.setState({ selectedString: 3 })
    moveString(1)
    expect(store.getState().selectedString).toBe(2)
  })

  it('clamps at the top string (tuning length)', () => {
    store.setState({ selectedString: 6 }) // 6-string tuning
    moveString(-1)
    expect(store.getState().selectedString).toBe(6)
  })

  it('clamps at the bottom string (1)', () => {
    store.setState({ selectedString: 1 })
    moveString(1)
    expect(store.getState().selectedString).toBe(1)
  })
})
