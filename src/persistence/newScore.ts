import { Settings, importer, model } from '@coderline/alphatab'
import type { FileMeta } from '../editor/store'
import { addFile } from './db'
import { exportGp7Bytes } from './export'

/**
 * A blank 6-string standard-tuning guitar tab: one empty 4/4 bar (a single whole rest) at 120 BPM.
 * Built as alphaTex rather than by hand-constructing the model — alphaTex's default track already IS
 * a standard-tuning 6-string guitar, so `r.1` (a whole rest) in one bar is the entire blank score, and
 * the importer wires up MasterBar/Bar/Voice/Beat/tuning for us. (`JsonConverter` isn't in the runtime
 * bundle and a hand-rolled model is verbose + easy to get subtly wrong — see clipboard.ts for why we
 * lean on alphaTab's own import/export round-trip.) The title and track name are set on the model after
 * parse so the user-supplied name never has to be alphaTex-escaped.
 */
const BLANK_TEX = '\\tempo 120\n.\nr.1 |'

/** Build a blank score (see {@link BLANK_TEX}) titled `name`. Pure — no persistence, no UI. */
export function buildBlankScore(name: string): model.Score {
  const imp = new importer.AlphaTexImporter()
  imp.logErrors = false
  imp.initFromString(BLANK_TEX, new Settings())
  const score = imp.readScore()
  score.title = name
  // alphaTex's default track has an empty name; give it a label so the track list isn't blank.
  if (score.tracks[0]) score.tracks[0].name = 'Guitar'
  return score
}

/**
 * Mint a blank tab as GP7 bytes and persist it as a new library file named `${name}.gp`. The bytes are
 * real GP7 (same format auto-save writes), so the new entry is indistinguishable from an imported file:
 * opening it goes through the normal `currentFileId` → `api.load(bytes)` path. Returns the new meta.
 */
export async function createBlankScore(name: string): Promise<FileMeta> {
  const bytes = exportGp7Bytes(buildBlankScore(name), new Settings())
  // Copy into a standalone ArrayBuffer — the exporter may hand back a view over a larger pooled buffer.
  return addFile(`${name}.gp`, bytes.slice().buffer as ArrayBuffer)
}
