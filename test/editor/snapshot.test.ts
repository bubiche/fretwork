import { describe, it, expect } from 'vitest'
import { scoreSnapshot } from '../../src/editor/snapshot'
import { makeMinimalScore } from '../fixtures/makeMinimalScore'

describe('scoreSnapshot', () => {
  it('is stable: two reads of an unmutated score are deep-equal', () => {
    const score = makeMinimalScore({ bars: 2, beatsPerBar: 2 })
    expect(scoreSnapshot(score)).toEqual(scoreSnapshot(score))
  })

  it('captures the touchable shape', () => {
    const score = makeMinimalScore({ bars: 1, beatsPerBar: 1, strings: 6, title: 'Abendrot' })
    const snap = scoreSnapshot(score)
    expect(snap.title).toBe('Abendrot')
    expect(snap.tracks).toHaveLength(1)
    expect(snap.tracks[0].name).toBe('Guitar')
    expect(snap.tracks[0].bars).toHaveLength(1)
    expect(snap.tracks[0].bars[0].voices[0].beats).toHaveLength(1)
    const notes = snap.tracks[0].bars[0].voices[0].beats[0].notes
    expect(notes).toHaveLength(6)
    expect(notes[0]).toEqual({ string: 1, fret: 1 })
  })

  it('detects a fret mutation', () => {
    const score = makeMinimalScore()
    const before = scoreSnapshot(score)
    score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].fret = 99
    expect(scoreSnapshot(score)).not.toEqual(before)
  })

  it('detects a duration mutation', () => {
    const score = makeMinimalScore()
    const before = scoreSnapshot(score)
    score.tracks[0].staves[0].bars[0].voices[0].beats[0].duration = 8
    expect(scoreSnapshot(score)).not.toEqual(before)
  })
})
