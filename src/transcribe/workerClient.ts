// Main-thread client for the inference worker. A single worker is reused for the lifetime of the
// page: warmUp() pays the cold-start once (on transcribe-panel open) and stays resident so reopening
// the panel and running again is instant. The worker module is loaded lazily — it isn't spawned until
// the first call here, so tfjs never downloads until the user actually opens the transcribe flow.
import type { NoteEventTime, TranscribeOptions, TranscribeResult } from './basicPitch';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

// Omit that distributes over the union so each variant keeps its own discriminant-specific fields
// (a plain Omit<WorkerRequest, 'id'> collapses to just the shared `type` key).
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (fraction: number) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const msg = ev.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'progress') {
      p.onProgress?.(msg.value);
      return;
    }
    pending.delete(msg.id);
    if (msg.type === 'error') p.reject(new Error(msg.message));
    else if (msg.type === 'ready') p.resolve({ backend: msg.backend });
    else p.resolve({ notes: msg.notes, backend: msg.backend, inferenceMs: msg.inferenceMs });
  };
  // A fatal worker error (e.g. backend init crash) has no request id — fail everything in flight.
  worker.onerror = (ev) => {
    const err = new Error(ev.message || 'transcription worker crashed');
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  };
  return worker;
}

function send<T>(req: DistributiveOmit<WorkerRequest, 'id'>, onProgress?: (f: number) => void, transfer?: Transferable[]): Promise<T> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as Pending['resolve'], reject, onProgress });
    w.postMessage({ ...req, id } as WorkerRequest, transfer ?? []);
  });
}

/** Kick off (or confirm) the cold-start. Resolves with the backend tfjs settled on inside the worker. */
export function warm(backend: TranscribeOptions['backend'] = 'webgl'): Promise<{ backend: string }> {
  return send<{ backend: string }>({ type: 'warm', backend });
}

/**
 * Transcribe mono 22050 Hz audio in the worker. `mono` is transferred (the caller must not reuse it).
 * onProgress reports the inference fraction 0..1.
 */
export function transcribe(
  mono: Float32Array,
  opts?: TranscribeOptions,
  onProgress?: (fraction: number) => void,
): Promise<TranscribeResult & { notes: NoteEventTime[] }> {
  return send({ type: 'transcribe', mono, opts }, onProgress, [mono.buffer]);
}
