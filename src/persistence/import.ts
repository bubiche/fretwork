import { store } from '../editor/store'
import { addFile, listFiles } from './db'

const SUPPORTED = /\.gp[3-8]?$/i

export async function importFiles(files: File[]): Promise<void> {
  let lastId: string | null = null
  const skipped: string[] = []
  for (const f of files) {
    if (!SUPPORTED.test(f.name)) {
      skipped.push(f.name)
      continue
    }
    const bytes = await f.arrayBuffer()
    const meta = await addFile(f.name, bytes)
    lastId = meta.id
  }
  const list = await listFiles()
  store.setState({
    files: list,
    ...(lastId ? { currentFileId: lastId, error: null } : {}),
    ...(skipped.length && !lastId ? { error: `Unsupported file(s): ${skipped.join(', ')}` } : {}),
  })
}
