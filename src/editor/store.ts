import type { AlphaTabApi } from '@coderline/alphatab'

export type FileMeta = {
  id: string
  name: string
  size: number
  addedAt: number
  lastOpenedAt: number
}

export type TransportState = {
  playbackSpeed: number
  metronome: boolean
  countIn: boolean
  playing: boolean
}

export type TrackUiState = {
  index: number
  name: string
  rendered: boolean
  muted: boolean
  soloed: boolean
}

export type LayoutModeOption = 'page' | 'horizontal'

export type ViewState = {
  zoom: number
  layoutMode: LayoutModeOption
}

export type StoreState = {
  currentFileId: string | null
  files: FileMeta[]
  error: string | null
  api: AlphaTabApi | null
  transport: TransportState
  tracks: TrackUiState[]
  view: ViewState
}

type Selector<T> = (s: StoreState) => T
type Listener<T> = (v: T) => void
export type Unsubscribe = () => void

type Entry = {
  selector: Selector<unknown>
  fn: Listener<unknown>
  prev: unknown
}

export const DEFAULT_TRANSPORT: TransportState = {
  playbackSpeed: 1,
  metronome: false,
  countIn: false,
  playing: false,
}

export const DEFAULT_VIEW: ViewState = {
  zoom: 1,
  layoutMode: 'page',
}

const initialState: StoreState = {
  currentFileId: null,
  files: [],
  error: null,
  api: null,
  transport: DEFAULT_TRANSPORT,
  tracks: [],
  view: DEFAULT_VIEW,
}

class Store {
  private state: StoreState = initialState
  private entries = new Set<Entry>()

  getState(): StoreState {
    return this.state
  }

  setState(patch: Partial<StoreState>): void {
    this.state = { ...this.state, ...patch }
    for (const e of this.entries) {
      const next = e.selector(this.state)
      if (next !== e.prev) {
        e.prev = next
        e.fn(next)
      }
    }
  }

  subscribe<T>(selector: Selector<T>, fn: Listener<T>): Unsubscribe {
    const entry: Entry = {
      selector: selector as Selector<unknown>,
      fn: fn as Listener<unknown>,
      prev: selector(this.state),
    }
    this.entries.add(entry)
    return () => {
      this.entries.delete(entry)
    }
  }
}

export const store = new Store()
