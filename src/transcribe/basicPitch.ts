// Thin wrapper over @spotify/basic-pitch. All heavy deps (tfjs + the model)
// are loaded via dynamic import() so they stay out of the initial bundle and
// only download when the user actually transcribes something.
import type { NoteEventTime } from '@spotify/basic-pitch';

export type { NoteEventTime };

// Model assets live in public/transcribe-model/ (copied from the npm package).
const MODEL_URL = `${import.meta.env.BASE_URL}transcribe-model/model.json`;

export interface TranscribeOptions {
  /** onset detection threshold (0..1). Higher = fewer, more confident notes. */
  onsetThresh?: number;
  /** frame (sustain) threshold (0..1). */
  frameThresh?: number;
  /** minimum note length in frames (~11ms each). */
  minNoteLen?: number;
  minFreqHz?: number | null;
  maxFreqHz?: number | null;
  /** 'webgl' (default in browsers) or 'wasm'/'cpu'. Null = let tfjs choose. */
  backend?: 'webgl' | 'wasm' | 'cpu' | null;
}

export interface TranscribeResult {
  notes: NoteEventTime[];
  backend: string;
  inferenceMs: number;
}

/** Run basic-pitch on mono 22050 Hz audio and return time-stamped note events. */
export async function audioToNotes(
  mono22050: Float32Array,
  opts: TranscribeOptions = {},
  onProgress?: (fraction: number) => void,
): Promise<TranscribeResult> {
  const [bp, tf] = await Promise.all([
    import('@spotify/basic-pitch'),
    import('@tensorflow/tfjs'),
  ]);

  if (opts.backend) {
    try {
      await tf.setBackend(opts.backend);
    } catch {
      /* fall back to whatever registered */
    }
  }
  await tf.ready();

  const model = new bp.BasicPitch(MODEL_URL);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  const t0 = performance.now();
  await model.evaluateModel(
    mono22050,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => onProgress?.(p),
  );

  let notes = bp.outputToNotesPoly(
    frames,
    onsets,
    opts.onsetThresh ?? 0.25,
    opts.frameThresh ?? 0.25,
    opts.minNoteLen ?? 5,
    true,
    opts.maxFreqHz ?? null,
    opts.minFreqHz ?? null,
  );
  notes = bp.addPitchBendsToNoteEvents(contours, notes);
  const timed = bp
    .noteFramesToTime(notes)
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

  return { notes: timed, backend: tf.getBackend(), inferenceMs: performance.now() - t0 };
}
