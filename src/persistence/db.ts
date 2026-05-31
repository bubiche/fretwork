import type { FileMeta } from '../editor/store'

const DB_NAME = 'fretwork'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        db.createObjectStore('meta', { keyPath: 'id' })
        db.createObjectStore('files', { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('IndexedDB open blocked'))
    })
  }
  return dbPromise
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function promisifyTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function listFiles(): Promise<FileMeta[]> {
  const db = await getDb()
  const all = await promisifyRequest(
    db.transaction('meta', 'readonly').objectStore('meta').getAll() as IDBRequest<FileMeta[]>,
  )
  return all.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
}

export async function getFileBytes(id: string): Promise<ArrayBuffer | null> {
  const db = await getDb()
  const row = await promisifyRequest(
    db.transaction('files', 'readonly').objectStore('files').get(id) as IDBRequest<
      { id: string; bytes: ArrayBuffer } | undefined
    >,
  )
  return row?.bytes ?? null
}

export async function addFile(name: string, bytes: ArrayBuffer): Promise<FileMeta> {
  const db = await getDb()
  const now = Date.now()
  const meta: FileMeta = {
    id: crypto.randomUUID(),
    name,
    size: bytes.byteLength,
    addedAt: now,
    lastOpenedAt: now,
  }
  const tx = db.transaction(['meta', 'files'], 'readwrite')
  tx.objectStore('meta').put(meta)
  tx.objectStore('files').put({ id: meta.id, bytes })
  await promisifyTx(tx)
  return meta
}

/**
 * Overwrite an existing file's bytes in place (auto-save). Keeps the same id/name so the
 * library entry and the open editor stay pointed at it; only the bytes + size change. alphaTab can
 * only write GP7, so a non-GP7 import becomes GP7 content under its original name after the first
 * save — the displayed name is just a label (alphaTab detects format by content on reload). No-op if
 * the row is gone (deleted between an edit and its debounced save).
 */
export async function updateFileBytes(id: string, bytes: ArrayBuffer): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['meta', 'files'], 'readwrite')
  const metaStore = tx.objectStore('meta')
  const meta = await promisifyRequest(metaStore.get(id) as IDBRequest<FileMeta | undefined>)
  if (!meta) {
    tx.abort()
    return
  }
  meta.size = bytes.byteLength
  metaStore.put(meta)
  tx.objectStore('files').put({ id, bytes })
  await promisifyTx(tx)
}

export async function touchLastOpened(id: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('meta', 'readwrite')
  const store = tx.objectStore('meta')
  const meta = await promisifyRequest(store.get(id) as IDBRequest<FileMeta | undefined>)
  if (!meta) return
  meta.lastOpenedAt = Date.now()
  store.put(meta)
  await promisifyTx(tx)
}

export async function renameFile(id: string, name: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('meta', 'readwrite')
  const store = tx.objectStore('meta')
  const meta = await promisifyRequest(store.get(id) as IDBRequest<FileMeta | undefined>)
  if (!meta) return
  meta.name = name
  store.put(meta)
  await promisifyTx(tx)
}

export async function deleteFile(id: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['meta', 'files'], 'readwrite')
  tx.objectStore('meta').delete(id)
  tx.objectStore('files').delete(id)
  await promisifyTx(tx)
}
