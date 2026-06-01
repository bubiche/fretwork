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
import { audioToNotes } from './basicPitch'
import { buildScoreFromNotes } from './buildScore'
import { exportGp7Bytes } from '../persistence/export'
import { addFile, listFiles } from '../persistence/db'
import { store } from '../editor/store'

/** Strip a leading directory and a known audio extension to get a display stem (`riff.wav` → `riff`). */
function stem(filename: string): string {
  return filename.replace(/^.*[/\\]/, '').replace(/\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i, '')
}

/**
 * Decode `file`, run it through the transcription pipeline, persist the result as a new `.gp` library
 * file, and open it. Resolves once the new tab is the current file. Throws on decode/inference failure
 * (the dev hook logs it); a clean buffer with no detectable notes still opens an empty editable tab.
 */
export async function transcribeToNewTab(file: File): Promise<void> {
  const name = stem(file.name)
  const buf = await file.arrayBuffer()
  const mono = await decodeToMono22050(buf)

  const { notes, backend, inferenceMs } = await audioToNotes(mono)
  // This raw dump is the whole point — inspect onsets/pitches/durations to calibrate later stages.
  console.info(
    `[transcribe] ${notes.length} raw note events · backend=${backend} · ${Math.round(inferenceMs)}ms`,
    notes,
  )

  const { score, dropped, unplayable, noteCount } = buildScoreFromNotes(notes, name)
  console.info(
    `[transcribe] placed ${noteCount} notes · ${dropped.length} dropped by mono collapse · ${unplayable.length} unplayable`,
    { dropped, unplayable },
  )

  const bytes = exportGp7Bytes(score, new Settings())
  // Copy into a standalone ArrayBuffer — the exporter may hand back a view over a larger pooled buffer.
  const meta = await addFile(`${name}.gp`, bytes.slice().buffer as ArrayBuffer)
  const list = await listFiles()
  store.setState({ files: list, currentFileId: meta.id, error: null })
}
