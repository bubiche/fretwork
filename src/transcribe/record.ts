// Mic capture (transcribe input source #2). Wraps getUserMedia + MediaRecorder into a record → stop →
// Blob handle. Everything past the Blob is the existing upload path: blob.arrayBuffer() →
// decodeToMono22050(...) → the same pipeline. The UI owns the elapsed timer and the duration cap; this
// module just captures and releases the mic.

export interface Recording {
  blob: Blob
  mimeType: string
}

export interface RecorderHandle {
  /** Stop recording, resolve with the captured blob, and release the mic. */
  stop(): Promise<Recording>
  /** Discard the recording and release the mic (no blob produced). */
  cancel(): void
}

// Let the browser pick by default (Chrome/Firefox → WebM/Opus, Safari → MP4/AAC); we always decode on
// the same browser that recorded, so the container round-trips. Probe a couple of preferred types only
// to nudge toward Opus where supported, falling back to the browser default.
const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined
  return PREFERRED_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
}

/**
 * Begin recording from the default mic. Rejects if the API is unavailable or the user denies access
 * (`NotAllowedError`) / has no input device (`NotFoundError`) — the caller maps those to a visible
 * message. Resolves with a handle whose stop()/cancel() both release the mic (OS indicator turns off).
 */
export async function startRecording(): Promise<RecorderHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Recording is not supported in this browser.')
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

  const mimeType = pickMimeType()
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data)
  }
  recorder.start()

  const release = () => stream.getTracks().forEach((t) => t.stop())

  return {
    stop() {
      return new Promise<Recording>((resolve, reject) => {
        recorder.onstop = () => {
          release()
          const type = recorder.mimeType || mimeType || 'audio/webm'
          resolve({ blob: new Blob(chunks, { type }), mimeType: type })
        }
        recorder.onerror = (ev) => {
          release()
          reject((ev as unknown as { error?: Error }).error ?? new Error('Recording failed.'))
        }
        if (recorder.state !== 'inactive') recorder.stop()
        else recorder.onstop?.(new Event('stop'))
      })
    },
    cancel() {
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
  }
}
