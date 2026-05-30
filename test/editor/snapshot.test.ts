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
    expect(notes[0]).toMatchObject({ string: 1, fret: 1 })
    // Phase 4: effect fields are captured at their "off" defaults on a freshly-built note/beat.
    expect(notes[0]).toMatchObject({
      isPalmMute: false,
      isGhost: false,
      isDead: false,
      vibrato: 0,
      isLetRing: false,
      isHammerPullOrigin: false,
      slideInType: 0,
      slideOutType: 0,
      isTieDestination: false,
      bendType: 0,
      bendPoints: null,
    })
    const beat0 = snap.tracks[0].bars[0].voices[0].beats[0]
    expect(beat0).toMatchObject({ whammyBarType: 0, tap: false, graceType: 0, chordId: null })
  })

  it('detects a note effect mutation (palm mute)', () => {
    const score = makeMinimalScore()
    const before = scoreSnapshot(score)
    score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].isPalmMute = true
    expect(scoreSnapshot(score)).not.toEqual(before)
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

  it('captures beat.dots and detects a dot mutation', () => {
    const score = makeMinimalScore()
    expect(scoreSnapshot(score).tracks[0].bars[0].voices[0].beats[0].dots).toBe(0)
    const before = scoreSnapshot(score)
    score.tracks[0].staves[0].bars[0].voices[0].beats[0].dots = 1
    expect(scoreSnapshot(score)).not.toEqual(before)
  })

  it('normalizes note order by string (append order does not affect the snapshot)', () => {
    const score = makeMinimalScore({ strings: 3 })
    const beat = score.tracks[0].staves[0].bars[0].voices[0].beats[0]
    const before = scoreSnapshot(score)
    // Remove the string-1 note and re-add it (appends to the end) — array order now differs,
    // but the snapshot must still be deep-equal because it sorts by string.
    const note = beat.notes.find((n) => n.string === 1)!
    beat.removeNote(note)
    beat.addNote(note)
    expect(beat.notes[beat.notes.length - 1].string).toBe(1) // appended, so order changed
    expect(scoreSnapshot(score)).toEqual(before) // snapshot sorts, so still equal
    expect(scoreSnapshot(score).tracks[0].bars[0].voices[0].beats[0].notes.map((n) => n.string)).toEqual([
      1, 2, 3,
    ])
  })
})
