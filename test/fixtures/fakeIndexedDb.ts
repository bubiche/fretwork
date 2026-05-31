/**
 * Minimal in-memory IndexedDB stub — ONLY the surface `src/persistence/db.ts` uses (open +
 * createObjectStore({keyPath}), transaction/objectStore, get/getAll/put/delete, abort, request
 * onsuccess/onerror, tx oncomplete/onerror/onabort). NOT a spec-compliant IndexedDB — just enough to
 * exercise db.ts headlessly without a dependency (the owner declined `fake-indexeddb`).
 *
 * Async model: each request settles on a MICROtask; a transaction auto-completes on the next
 * MACROtask once no request is pending. That ordering is the load-bearing bit — db.ts `await`s
 * between two requests of the same transaction (read meta → put meta), and microtasks fully drain
 * before the macrotask completion check, so the second request is enqueued before the tx completes,
 * exactly as a real IndexedDB transaction stays alive across such an await. The db-roundtrip test
 * passing against the unmodified db.ts is the evidence this stub models the contract adequately.
 *
 * Side-effect import: installs `globalThis.indexedDB` on load. Import it before importing db.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

class FakeRequest<T> {
  result: T | undefined
  error: unknown = null
  onsuccess: (() => void) | null = null
  onerror: (() => void) | null = null
}

class FakeObjectStore {
  constructor(private data: Map<any, any>, private keyPath: string, private tx: FakeTransaction) {}
  private run<T>(op: () => T): FakeRequest<T> {
    const req = new FakeRequest<T>()
    this.tx.track()
    queueMicrotask(() => {
      try {
        req.result = op()
        req.onsuccess?.()
      } catch (e) {
        req.error = e
        req.onerror?.()
      }
      this.tx.untrack()
    })
    return req
  }
  get(key: any) { return this.run(() => this.data.get(key)) }
  getAll() { return this.run(() => [...this.data.values()]) }
  put(value: any) { return this.run(() => void this.data.set(value[this.keyPath], value)) }
  delete(key: any) { return this.run(() => void this.data.delete(key)) }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  error: unknown = null
  private pending = 0
  private done = false
  private aborted = false
  constructor(private db: FakeDB, private storeNames: string[]) {}
  objectStore(name: string): FakeObjectStore {
    if (!this.storeNames.includes(name)) throw new Error(`store '${name}' not in transaction`)
    return new FakeObjectStore(this.db.store(name), this.db.keyPathOf(name), this)
  }
  track(): void {
    this.pending++
  }
  untrack(): void {
    this.pending--
    setTimeout(() => {
      if (this.done || this.aborted) return
      if (this.pending === 0) {
        this.done = true
        this.oncomplete?.()
      }
    }, 0)
  }
  abort(): void {
    if (this.done) return
    this.aborted = true
    setTimeout(() => this.onabort?.(), 0)
  }
}

class FakeDB {
  private stores = new Map<string, Map<any, any>>()
  private keyPaths = new Map<string, string>()
  createObjectStore(name: string, opts: { keyPath: string }): unknown {
    this.stores.set(name, new Map())
    this.keyPaths.set(name, opts.keyPath)
    return {}
  }
  store(name: string): Map<any, any> {
    return this.stores.get(name)!
  }
  keyPathOf(name: string): string {
    return this.keyPaths.get(name)!
  }
  transaction(names: string | string[]): FakeTransaction {
    return new FakeTransaction(this, Array.isArray(names) ? names : [names])
  }
}

class FakeOpenRequest {
  result = new FakeDB()
  error: unknown = null
  onupgradeneeded: (() => void) | null = null
  onsuccess: (() => void) | null = null
  onerror: (() => void) | null = null
  onblocked: (() => void) | null = null
}

;(globalThis as any).indexedDB = {
  open(_name: string, _version?: number) {
    const req = new FakeOpenRequest()
    // Fire on a microtask so db.ts's synchronously-assigned handlers are attached first.
    queueMicrotask(() => {
      req.onupgradeneeded?.()
      req.onsuccess?.()
    })
    return req
  },
}
