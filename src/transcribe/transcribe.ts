// End-to-end transcription pipeline: audio file → editable tab opened as a new file.
//
//   File ─▶ decodeToMono22050 ─▶ audioToNotes (basic-pitch) ─▶ detectTempo   = analyzeClip
//        ─▶ buildScoreFromNotes ─▶ GP7 bytes ─▶ addFile ─▶ store.currentFileId = openNotesAsNewTab
//
// Split in two so the UI can pause between them: inference produces the notes *and* a detected BPM,
// the user reviews/overrides the BPM, then the tab is created — changing the BPM never re-runs the
// model, just rebuilds the score from the cached notes.
//
// Mirrors createBlankScore (newScore.ts): mint a real GP7 file and point the editor at it, so the new
// tab is indistinguishable from an imported file — every subsequent edit goes through the Command stack.
import { Settings } from '@coderline/alphatab'
import type { NoteEventTime } from './basicPitch'
import { decodeToMono22050 } from './decode'
import { transcribe as runInWorker } from './workerClient'
import { detectTempo, DEFAULT_BPM } from './detectTempo'
import { DEFAULT_GRID_DIVISION, type GridDivision } from './quantize'
import { buildScoreFromNotes } from './buildScore'
import { exportGp7Bytes } from '../persistence/export'
import { addFile, listFiles } from '../persistence/db'
import { store } from '../editor/store'

/** Strip a leading directory and a known audio extension to get a display stem (`riff.wav` → `riff`). */
export function stem(filename: string): string {
  return filename.replace(/^.*[/\\]/, '').replace(/\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i, '')
}

export interface AnalyzedClip {
  /** Raw basic-pitch note events — cache these; rebuilding with a different BPM needs no re-inference. */
  notes: NoteEventTime[]
  /** IOI-clustering tempo estimate, or null when the clip was too sparse/ambiguous to call. */
  detectedBpm: number | null
}

/**
 * Decode `input` and run inference + tempo detection. `input` is a `File` (upload) or a `Blob` (mic
 * recording) — indistinguishable past decode.ts. Throws on decode/inference failure. `onProgress`
 * forwards the worker's inference fraction (0..1).
 */
export async function analyzeClip(
  input: File | Blob,
  onProgress?: (fraction: number) => void,
): Promise<AnalyzedClip> {
  const buf = await input.arrayBuffer()
  const mono = await decodeToMono22050(buf)

  const { notes, backend, inferenceMs } = await runInWorker(mono, undefined, onProgress)
  const detectedBpm = detectTempo(notes)
  // This raw dump is the whole point — inspect onsets/pitches/durations to calibrate later stages.
  console.info(
    `[transcribe] ${notes.length} raw note events · backend=${backend} · ${Math.round(inferenceMs)}ms · detected ${detectedBpm ?? 'no'} BPM`,
    notes,
  )
  return { notes, detectedBpm }
}

/**
 * Build a score from already-analyzed notes at `bpm` on a `division` grid, persist it as a new `.gp`
 * library file, and open it. Resolves once the new tab is the current file. A buffer with no detectable
 * notes still opens an empty editable tab.
 */
export async function openNotesAsNewTab(
  notes: NoteEventTime[],
  name: string,
  bpm: number,
  division: GridDivision = DEFAULT_GRID_DIVISION,
): Promise<void> {
  const { score, dropped, unplayable, noteCount } = buildScoreFromNotes(notes, name, bpm, division)
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

/**
 * One-shot pipeline (analyze → open at the detected BPM, no review pause). Kept for the dev hook;
 * the modal calls the two halves so the user can override the BPM in between.
 */
export async function transcribeToNewTab(
  input: File | Blob,
  name?: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const stemName = name ?? (input instanceof File ? stem(input.name) : 'Recording')
  const { notes, detectedBpm } = await analyzeClip(input, onProgress)
  await openNotesAsNewTab(notes, stemName, detectedBpm ?? DEFAULT_BPM)
}
