import { exporter, type model, type Settings } from '@coderline/alphatab'
import { store } from '../editor/store'

/**
 * Phase 6 export. alphaTab ships two exporters off the public bundle:
 *   - `Gp7Exporter` → GP7 binary (`.gp`), full-fidelity for guitar effects. This is also the
 *     auto-save and copy/paste clone path, so it's the battle-tested one (bends lossless, whammy
 *     stable — see implementation_notes). GP3–8 imports all become GP7 on export (alphaTab writes
 *     GP7 only). Known lossy case: a key signature set on a NON-track-0 staff is dropped, because GP
 *     stores key sig once per bar at MasterBar level (= track 0) — Q13 finding.
 *   - `AlphaTexExporter` → alphaTex text (`.alphatab`), human-readable. Round-trips bends/whammy/
 *     harmonics on our fixtures, but is the less-exercised path; treat as the readable companion.
 *
 * There is no MusicXML/Capella exporter — a non-GP import can only leave as `.gp` or `.alphatab`.
 */
export type ExportFormat = 'gp' | 'alphatab'

export const EXPORT_FORMATS: { readonly format: ExportFormat; readonly label: string; readonly ext: string }[] = [
  { format: 'gp', label: 'Guitar Pro 7 (.gp)', ext: 'gp' },
  { format: 'alphatab', label: 'alphaTex (.alphatab)', ext: 'alphatab' },
]

/** GP7 bytes for a score. Shared by auto-save and the GP export path. Throws if alphaTab does. */
export function exportGp7Bytes(score: model.Score, settings: Settings): Uint8Array {
  return new exporter.Gp7Exporter().export(score, settings)
}

/** alphaTex text for a score. */
export function exportAlphaTex(score: model.Score, settings: Settings): string {
  return new exporter.AlphaTexExporter().exportToString(score, settings)
}

/** Strip a trailing import extension so we can swap in the export one (`song.gp5` → `song`). */
function baseName(name: string): string {
  return name.replace(/\.(gp[3-8]?|musicxml|mxl|xml|capx?|alphatab)$/i, '')
}

/** Push a Blob to the browser as a download named `filename`. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick — revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Export the currently-loaded score to disk in `format`. No-op when no score is loaded. The download
 * name is derived from the current library entry (its extension swapped for the export one), falling
 * back to the score title or "score". Errors propagate to the caller (the UI surfaces a toast).
 */
export function downloadCurrentScore(format: ExportFormat): void {
  const { api, currentFileId, files } = store.getState()
  const score = api?.score
  const settings = api?.settings
  if (!score || !settings) return

  const meta = files.find((f) => f.id === currentFileId)
  const stem = meta ? baseName(meta.name) : score.title || 'score'
  const spec = EXPORT_FORMATS.find((f) => f.format === format)!

  if (format === 'gp') {
    const bytes = exportGp7Bytes(score, settings)
    // Copy into a fresh ArrayBuffer — the Blob ctor wants ArrayBuffer/typed-array, and slicing
    // guards against the exporter handing back a view over a larger/pooled buffer.
    triggerDownload(new Blob([bytes.slice()], { type: 'application/octet-stream' }), `${stem}.${spec.ext}`)
  } else {
    const text = exportAlphaTex(score, settings)
    triggerDownload(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${stem}.${spec.ext}`)
  }
}
