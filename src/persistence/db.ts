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
