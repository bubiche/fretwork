import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Auto-save ORCHESTRATION (debounce / flush-on-switch / failure-safety). The actual GP7
 * export + IndexedDB write are mocked here — those are covered end-to-end in db-roundtrip.test.ts and
 * export.fixture.test.ts. This file pins the timing-dependent logic in the data-loss-sensitive path:
 * the flush-on-file-switch especially, which has no other coverage.
 */
const { updateFileBytesMock, exportMock } = vi.hoisted(() => ({
  updateFileBytesMock: vi.fn((): Promise<void> => Promise.resolve()),
  exportMock: vi.fn(() => new Uint8Array([1, 2, 3])),
}))
vi.mock('../../src/persistence/db', () => ({ updateFileBytes: updateFileBytesMock }))
vi.mock('../../src/persistence/export', () => ({ exportGp7Bytes: exportMock }))

import { attachAutosave } from '../../src/persistence/autosave'
import { store } from '../../src/editor/store'

// Minimal fake api — autosave only reads `api.score` and `api.settings` (both just passed to the
// mocked export). Non-null is all that matters.
const fakeApi = () => ({ score: {}, settings: {} }) as never

let detach: () => void

beforeEach(() => {
  vi.useFakeTimers()
  updateFileBytesMock.mockClear()
  exportMock.mockClear()
  exportMock.mockImplementation(() => new Uint8Array([1, 2, 3]))
  // Reset the store slots autosave reads, BEFORE attaching (so the subscriber's prev = version 0).
  store.setState({ api: fakeApi(), currentFileId: 'A', scoreVersion: 0 })
  detach = attachAutosave()
})

afterEach(() => {
  detach()
  vi.useRealTimers()
})

describe('auto-save orchestration', () => {
  it('writes the current file once, ~1s after an edit', () => {
    store.setState({ scoreVersion: 1 })
    expect(updateFileBytesMock).not.toHaveBeenCalled() // debounced — nothing yet
    vi.advanceTimersByTime(1000)
    expect(updateFileBytesMock).toHaveBeenCalledTimes(1)
    expect(updateFileBytesMock.mock.calls[0][0]).toBe('A')
  })

  it('coalesces a burst of edits into one write', () => {
    store.setState({ scoreVersion: 1 })
    vi.advanceTimersByTime(400)
    store.setState({ scoreVersion: 2 })
    vi.advanceTimersByTime(400)
    store.setState({ scoreVersion: 3 })
    vi.advanceTimersByTime(1000)
    expect(updateFileBytesMock).toHaveBeenCalledTimes(1)
  })

  it('flushes the OUTGOING file synchronously on a file switch (no lost edit, no wrong target)', () => {
    store.setState({ scoreVersion: 1 }) // edit on A, save pending
    expect(updateFileBytesMock).not.toHaveBeenCalled()
    store.setState({ currentFileId: 'B' }) // switch before the debounce fires
    // Flushed synchronously, under A's id — NOT B's, and not dropped.
    expect(updateFileBytesMock).toHaveBeenCalledTimes(1)
    expect(updateFileBytesMock.mock.calls[0][0]).toBe('A')
    vi.advanceTimersByTime(2000) // the old timer must not fire a second write
    expect(updateFileBytesMock).toHaveBeenCalledTimes(1)
  })

  it('does not save when no file is open', () => {
    store.setState({ currentFileId: null, scoreVersion: 5 })
    vi.advanceTimersByTime(2000)
    expect(updateFileBytesMock).not.toHaveBeenCalled()
  })

  it('swallows an export failure without throwing or writing', () => {
    exportMock.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    store.setState({ scoreVersion: 1 })
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
    expect(updateFileBytesMock).not.toHaveBeenCalled()
  })

  it('stops saving after detach', () => {
    detach()
    store.setState({ scoreVersion: 1 })
    vi.advanceTimersByTime(2000)
    expect(updateFileBytesMock).not.toHaveBeenCalled()
  })
})
