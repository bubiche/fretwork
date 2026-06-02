// Inference Web Worker: runs basic-pitch + tfjs (WebGL) off the main thread so the UI never freezes
// during the ~seconds-long model run. Decoding stays on the main thread (Web Audio decodeAudioData
// isn't reliable in workers); this worker only ever sees the mono 22050 Hz Float32Array.
//
// Spawned by workerClient.ts via `new Worker(new URL('./worker.ts', import.meta.url), {type:'module'})`,
// which Vite bundles into its own chunk — that's the lazy boundary that keeps tfjs out of the entry bundle.
import { warmUp, audioToNotes } from './basicPitch';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

// tfjs 3.21's WebGL backend runs fine in a Worker, but its `PlatformBrowser.setTimeoutCustom` (used by
// the GPU fence poll) opens with `if (!window || ...)`. In a Worker `window` is an *undeclared*
// identifier, so `!window` throws ReferenceError before the guard can fall through. `USE_SETTIMEOUTCUSTOM`
// defaults to false, so once `window` merely *resolves* the guard takes the plain-setTimeout branch and
// never touches `window.postMessage` (which in a Worker would post to the main thread). Alias it to the
// worker global. Safe to run here: tfjs is only imported lazily (on the first message), never at module
// init, so this assignment lands first.
(globalThis as { window?: unknown }).window ??= globalThis;

function post(msg: WorkerResponse) {
  self.postMessage(msg);
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'warm') {
      const { backend } = await warmUp(req.backend ?? 'webgl');
      post({ id: req.id, type: 'ready', backend });
      return;
    }
    if (req.type === 'transcribe') {
      const { notes, backend, inferenceMs } = await audioToNotes(
        req.mono,
        req.opts,
        (value) => post({ id: req.id, type: 'progress', value }),
      );
      post({ id: req.id, type: 'result', notes, backend, inferenceMs });
      return;
    }
  } catch (err) {
    post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
