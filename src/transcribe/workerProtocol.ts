// Message contract between the main thread (workerClient.ts) and the inference worker (worker.ts).
// Type-only — erased at build, so importing it from either side pulls in no runtime.
import type { NoteEventTime, TranscribeOptions } from './basicPitch';

/** Main thread → worker. `id` correlates a request with its terminal response. */
export type WorkerRequest =
  | { id: number; type: 'warm'; backend?: TranscribeOptions['backend'] }
  | { id: number; type: 'transcribe'; mono: Float32Array; opts?: TranscribeOptions };

/** Worker → main thread. `progress` is non-terminal; the others resolve/reject the request. */
export type WorkerResponse =
  | { id: number; type: 'progress'; value: number }
  | { id: number; type: 'ready'; backend: string }
  | { id: number; type: 'result'; notes: NoteEventTime[]; backend: string; inferenceMs: number }
  | { id: number; type: 'error'; message: string };
