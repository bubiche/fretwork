import { store } from '../editor/store'
import { addFile, listFiles } from './db'

// alphaTab auto-detects format by content at load time, so this gate is purely a UX filter.
// Guitar Pro (.gp/.gp3–.gp8), MusicXML (.musicxml/.mxl/.xml), Capella (.capx/.cap), and
// alphaTex (.alphatab) all import into the same format-agnostic Score model — the editor is
// indifferent to the source.
const SUPPORTED = /\.(gp[3-8]?|musicxml|mxl|xml|capx?|alphatab)$/i

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
