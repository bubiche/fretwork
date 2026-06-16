import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Settings, model } from '@coderline/alphatab'
import type { NoteEventTime } from '../../src/transcribe/basicPitch'
import { buildScoreFromNotes } from '../../src/transcribe/buildScore'
import { detectTempo, DEFAULT_BPM } from '../../src/transcribe/detectTempo'

// Model-backed integration test: real basic-pitch model → quantize → fret-assign → buildScore, asserting
// the phase done-criterion (the 8-note melody) on the synthetic fixture. The one link the deterministic
// buildScore.test.ts stubs out (the model itself) is exercised here, so a corrupt model.json, a tfjs
// version drift, or a changed outputToNotesPoly param would fail this even though the deterministic
// chain still passed.
//
// NOT covered (this is a *parallel* harness, not the production path):
//   - CPU backend + a filesystem IOHandler + manual WAV parsing — production is WebGL + URL fetch +
//     the Web Worker + decode.ts (Web Audio), none of which run headless in Node.
//   - The full real pipeline is still verified by the manual browser run (window.__transcribe).
//
// Skipped by default: it loads tfjs and runs ~3s of CPU inference, which would dominate the otherwise
// sub-second suite. Run it explicitly with `npm run test:model` (sets RUN_MODEL_TESTS=1).
const RUN = !!process.env.RUN_MODEL_TESTS
if (!RUN) {
  // eslint-disable-next-line no-console
  console.info('[integration.model] skipped — set RUN_MODEL_TESTS=1 (npm run test:model) to run the real model.')
}

// The synthetic fixture's ground-truth melody: E2 G2 A2 B2 D3 B2 A2 G2.
const MIDI_SEQUENCE = [40, 43, 45, 47, 50, 47, 45, 43]
const MODEL_DIR = 'public/transcribe-model'
const FIXTURE_WAV = 'test/fixtures/transcribe-sample.wav'

/** Parse a 16-bit PCM mono WAV into a normalized Float32Array. The fixture is already mono @22050. */
function readMonoWav(path: string): Float32Array {
  const buf = readFileSync(path)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let off = 12 // skip RIFF header + 'WAVE'
  let dataOff = 0
  let dataSz = 0
  while (off + 8 <= buf.length) {
    const id = String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3])
    const sz = dv.getUint32(off + 4, true)
    if (id === 'data') {
      dataOff = off + 8
      dataSz = sz
      break
    }
    off += 8 + sz
  }
  const n = Math.floor(dataSz / 2)
  const mono = new Float32Array(n)
  for (let i = 0; i < n; i++) mono[i] = dv.getInt16(dataOff + i * 2, true) / 32768
  return mono
}

/**
 * Load the shipped model from disk via a custom IOHandler (Node `fetch` can't reach a `file://` URL,
 * and we deliberately avoid the tfjs-node native dep). Returns the same post-processing audioToNotes
 * runs, so the produced NoteEventTime[] match the production worker's — only the backend/loader differ.
 */
async function runModel(mono: Float32Array): Promise<NoteEventTime[]> {
  const tf = await import('@tensorflow/tfjs')
  const bp = await import('@spotify/basic-pitch')
  await tf.setBackend('cpu')
  await tf.ready()

  const modelJson = JSON.parse(readFileSync(`${MODEL_DIR}/model.json`, 'utf8'))
  const weights = readFileSync(`${MODEL_DIR}/group1-shard1of1.bin`)
  const handler: import('@tensorflow/tfjs').io.IOHandler = {
    load: async () => ({
      modelTopology: modelJson.modelTopology,
      weightSpecs: modelJson.weightsManifest[0].weights,
      weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
      format: modelJson.format,
      generatedBy: modelJson.generatedBy,
      convertedBy: modelJson.convertedBy,
    }),
  }

  const model = new bp.BasicPitch(tf.loadGraphModel(handler))
  const frames: number[][] = []
  const onsets: number[][] = []
  const contours: number[][] = []
  await model.evaluateModel(
    mono,
    (f, o, c) => {
      frames.push(...f)
      onsets.push(...o)
      contours.push(...c)
    },
    () => {},
  )
  // Identical params to audioToNotes (basicPitch.ts) so the note events match the production path.
  let notes = bp.outputToNotesPoly(frames, onsets, 0.25, 0.25, 5, true, null, null)
  notes = bp.addPitchBendsToNoteEvents(contours, notes)
  return bp.noteFramesToTime(notes).sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
}

function pitchesOf(score: model.Score): number[] {
  score.finish(new Settings())
  return score.tracks[0].staves[0].bars
    .flatMap((bar) => bar.voices[0].beats)
    .filter((b) => !b.isRest && !b.notes[0].isTieDestination)
    .map((b) => (b.notes[0] as unknown as { realValue: number }).realValue)
}

describe.skipIf(!RUN)('model-backed transcription (fixture wav → melody)', () => {
  it(
    'transcribes transcribe-sample.wav to E2 G2 A2 B2 D3 B2 A2 G2',
    async () => {
      const mono = readMonoWav(FIXTURE_WAV)
      const notes = await runModel(mono)
      expect(notes.length).toBeGreaterThan(0)

      // Mirror the production review-step defaults: detected tempo (≈150 here), default 8th grid.
      const bpm = detectTempo(notes) ?? DEFAULT_BPM
      const { score, noteCount } = buildScoreFromNotes(notes, 'Fixture', bpm)

      expect(noteCount).toBe(MIDI_SEQUENCE.length)
      expect(pitchesOf(score)).toEqual(MIDI_SEQUENCE)
    },
    30_000,
  )
})
