import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { FileMeta } from '../editor/store'

interface FretworkDB extends DBSchema {
  meta: {
    key: string
    value: FileMeta
  }
  files: {
    key: string
    value: { id: string; bytes: ArrayBuffer }
  }
}

const DB_NAME = 'fretwork'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<FretworkDB>> | null = null

function getDb(): Promise<IDBPDatabase<FretworkDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FretworkDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('meta', { keyPath: 'id' })
        db.createObjectStore('files', { keyPath: 'id' })
      },
    })
  }
  return dbPromise
}

export async function listFiles(): Promise<FileMeta[]> {
  const db = await getDb()
  const all = await db.getAll('meta')
  return all.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
}

export async function getFileBytes(id: string): Promise<ArrayBuffer | null> {
  const db = await getDb()
  const row = await db.get('files', id)
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
  await Promise.all([
    tx.objectStore('meta').put(meta),
    tx.objectStore('files').put({ id: meta.id, bytes }),
    tx.done,
  ])
  return meta
}

export async function touchLastOpened(id: string): Promise<void> {
  const db = await getDb()
  const meta = await db.get('meta', id)
  if (!meta) return
  meta.lastOpenedAt = Date.now()
  await db.put('meta', meta)
}

export async function deleteFile(id: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['meta', 'files'], 'readwrite')
  await Promise.all([
    tx.objectStore('meta').delete(id),
    tx.objectStore('files').delete(id),
    tx.done,
  ])
}
