export type FileMeta = {
  id: string
  name: string
  size: number
  addedAt: number
  lastOpenedAt: number
}

export type StoreState = {
  currentFileId: string | null
  files: FileMeta[]
  error: string | null
}

type Selector<T> = (s: StoreState) => T
type Listener<T> = (v: T) => void
export type Unsubscribe = () => void

type Entry = {
  selector: Selector<unknown>
  fn: Listener<unknown>
  prev: unknown
}

const initialState: StoreState = {
  currentFileId: null,
  files: [],
  error: null,
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
