// End-to-end transcription pipeline: audio file → editable tab opened as a new file.
//
//   File ─▶ decodeToMono22050 ─▶ audioToNotes (basic-pitch) ─▶ buildScoreFromNotes ─▶ GP7 bytes ─▶
//   addFile ─▶ store.currentFileId  (the existing "open as new file" path)
//
// Mirrors createBlankScore (newScore.ts): mint a real GP7 file and point the editor at it, so the new
// tab is indistinguishable from an imported file — every subsequent edit goes through the Command stack.
// This is a thin first pass; it logs the raw model output (and what the mono collapse dropped) so we can
// eyeball real results and calibrate how much the quantizer and fret assigner actually need.
import { Settings } from '@coderline/alphatab'
import { decodeToMono22050 } from './decode'
import { transcribe as runInWorker } from './workerClient'
import { buildScoreFromNotes } from './buildScore'
import { exportGp7Bytes } from '../persistence/export'
import { addFile, listFiles } from '../persistence/db'
import { store } from '../editor/store'

/** Strip a leading directory and a known audio extension to get a display stem (`riff.wav` → `riff`). */
function stem(filename: string): string {
  return filename.replace(/^.*[/\\]/, '').replace(/\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i, '')
}

/**
 * Decode `input`, run it through the transcription pipeline, persist the result as a new `.gp` library
 * file, and open it. Resolves once the new tab is the current file. Throws on decode/inference failure;
 * a clean buffer with no detectable notes still opens an empty editable tab.
 *
 * `input` is a `File` (upload) or a `Blob` (mic recording) — indistinguishable past decode.ts. `name`
 * overrides the display stem (required for blobs, which have no filename). `onProgress` forwards the
 * worker's inference fraction (0..1).
 */
export async function transcribeToNewTab(
  input: File | Blob,
  name?: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const stemName = name ?? (input instanceof File ? stem(input.name) : 'Recording')
  const buf = await input.arrayBuffer()
  const mono = await decodeToMono22050(buf)

  const { notes, backend, inferenceMs } = await runInWorker(mono, undefined, onProgress)
  // This raw dump is the whole point — inspect onsets/pitches/durations to calibrate later stages.
  console.info(
    `[transcribe] ${notes.length} raw note events · backend=${backend} · ${Math.round(inferenceMs)}ms`,
    notes,
  )

  const { score, dropped, unplayable, noteCount } = buildScoreFromNotes(notes, stemName)
  console.info(
    `[transcribe] placed ${noteCount} notes · ${dropped.length} dropped by mono collapse · ${unplayable.length} unplayable`,
    { dropped, unplayable },
  )

  const bytes = exportGp7Bytes(score, new Settings())
  // Copy into a standalone ArrayBuffer — the exporter may hand back a view over a larger pooled buffer.
  const meta = await addFile(`${stemName}.gp`, bytes.slice().buffer as ArrayBuffer)
  const list = await listFiles()
  store.setState({ files: list, currentFileId: meta.id, error: null })
}
