import { describe, it, expect } from 'vitest'
import { Settings, importer } from '@coderline/alphatab'
import { SetScoreInfoCommand } from '../../../src/editor/commands'
import { buildBlankScore } from '../../../src/persistence/newScore'
import { exportGp7Bytes } from '../../../src/persistence/export'
import { makeMinimalScore } from '../../fixtures/makeMinimalScore'

describe('SetScoreInfoCommand', () => {
  it('sets title and artist; undo restores both priors', () => {
    const score = makeMinimalScore({ bars: 1 })
    score.title = 'Old Title'
    score.artist = 'Old Artist'

    const cmd = new SetScoreInfoCommand('New Title', 'New Artist')
    cmd.apply(score)
    expect(score.title).toBe('New Title')
    expect(score.artist).toBe('New Artist')

    cmd.undo(score)
    expect(score.title).toBe('Old Title')
    expect(score.artist).toBe('Old Artist')
  })

  it('redo (re-apply) does not recapture the values it just wrote', () => {
    const score = makeMinimalScore({ bars: 1 })
    score.title = 'Original'

    const cmd = new SetScoreInfoCommand('Renamed', '')
    cmd.apply(score)
    cmd.undo(score)
    cmd.apply(score) // redo
    expect(score.title).toBe('Renamed')

    cmd.undo(score)
    expect(score.title).toBe('Original') // prior survived the redo cycle
  })

  // Auto-save persists edits as GP7 bytes, so the rename only sticks if title/artist survive
  // the export → reload cycle.
  it('title and artist survive a GP7 round-trip', () => {
    const score = buildBlankScore('Untitled')
    new SetScoreInfoCommand('Stairway to Freebird', 'Spinal Tap').apply(score)

    const bytes = exportGp7Bytes(score, new Settings())
    const round = importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings())
    expect(round.title).toBe('Stairway to Freebird')
    expect(round.artist).toBe('Spinal Tap')
  })

  it('allows clearing fields to empty strings', () => {
    const score = makeMinimalScore({ bars: 1 })
    score.title = 'Something'
    score.artist = 'Someone'

    const cmd = new SetScoreInfoCommand('', '')
    cmd.apply(score)
    expect(score.title).toBe('')
    expect(score.artist).toBe('')

    cmd.undo(score)
    expect(score.title).toBe('Something')
    expect(score.artist).toBe('Someone')
  })
})
