// Thin wrapper over @spotify/basic-pitch. All heavy deps (tfjs + the model)
// are loaded via dynamic import() so they stay out of the initial bundle and
// only download when the user actually transcribes something.
//
// Intended to run **inside the inference Web Worker** (see worker.ts). The module-level
// cache below means warmUp() pays the cold-start (model fetch + WebGL shader compile)
// once, and the subsequent real audioToNotes() call reuses the same backend + model
// instance. Importing only the `NoteEventTime` *type* elsewhere (quantize/buildScore)
// is erased at compile time, so this runtime never leaks into the main bundle.
import type { BasicPitch, NoteEventTime } from '@spotify/basic-pitch';

export type { NoteEventTime };

// Model assets live in public/transcribe-model/ (copied from the npm package).
const MODEL_URL = `${import.meta.env.BASE_URL}transcribe-model/model.json`;

type Tf = typeof import('@tensorflow/tfjs');
type Bp = typeof import('@spotify/basic-pitch');

interface Loaded {
  tf: Tf;
  bp: Bp;
  model: BasicPitch;
  backend: string;
}

// One backend + model instance per worker, shared by warmUp() and audioToNotes().
let loaded: Promise<Loaded> | null = null;

/**
 * Load tfjs + basic-pitch, select the backend, and construct the model. Idempotent and cached:
 * the first call wins, every later call returns the same instance. `backend` defaults to WebGL
 * (the v1 choice from the 8.0 spike); pass another to benchmark. Null lets tfjs pick.
 */
async function load(backend: 'webgl' | 'wasm' | 'cpu' | null = 'webgl'): Promise<Loaded> {
  if (loaded) return loaded;
  loaded = (async () => {
    const [bp, tf] = await Promise.all([
      import('@spotify/basic-pitch'),
      import('@tensorflow/tfjs'),
    ]);
    if (backend) {
      try {
        await tf.setBackend(backend);
      } catch {
        /* fall back to whatever registered (e.g. cpu) */
      }
    }
    await tf.ready();
    // Belt-and-suspenders for the worker: keep the fence poll on plain setTimeout. The default is
    // already false, but if anything flipped it the postMessage path would target the main thread.
    try {
      tf.env().set('USE_SETTIMEOUTCUSTOM', false);
    } catch {
      /* flag not registered on this build — default (false) already applies */
    }
    const model = new bp.BasicPitch(MODEL_URL);
    return { tf, bp, model, backend: tf.getBackend() };
  })();
  // Don't cache a rejected load — clear it so a later call (e.g. a retry after a transient model
  // fetch failure) re-attempts instead of replaying the same rejection forever.
  loaded.catch(() => {
    loaded = null;
  });
  return loaded;
}

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

/**
 * Pay the cold-start now: load tfjs+basic-pitch, select the backend, and run a short buffer of
 * silence through the model so the WebGL shaders compile and the model weights fetch before the
 * user hits Transcribe. Resolves with the backend tfjs actually settled on (so the caller can
 * tell whether WebGL stuck or it silently fell back to cpu). Idempotent.
 */
export async function warmUp(
  backend: 'webgl' | 'wasm' | 'cpu' | null = 'webgl',
): Promise<{ backend: string }> {
  const { model, backend: settled } = await load(backend);
  // ~1s of zeros at 22050 Hz — enough to exercise the conv ops and compile shaders without
  // a meaningful inference cost. Discard the output.
  const silence = new Float32Array(22050);
  await model.evaluateModel(
    silence,
    () => {},
    () => {},
  );
  return { backend: settled };
}

/** Run basic-pitch on mono 22050 Hz audio and return time-stamped note events. */
export async function audioToNotes(
  mono22050: Float32Array,
  opts: TranscribeOptions = {},
  onProgress?: (fraction: number) => void,
): Promise<TranscribeResult> {
  const { bp, tf, model } = await load(opts.backend ?? 'webgl');

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
