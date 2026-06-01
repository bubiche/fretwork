// Audio decode for transcription. Browser-only (uses Web Audio API).
// basic-pitch requires mono Float32Array at 22050 Hz.

export const TARGET_SAMPLE_RATE = 22050;

/**
 * Decode an encoded audio file (mp3/wav/ogg/m4a/…) to a mono Float32Array
 * resampled to 22050 Hz, as basic-pitch expects.
 */
export async function decodeToMono22050(data: ArrayBuffer): Promise<Float32Array> {
  const AC: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  // decodeAudioData detaches the buffer; pass a copy so callers can reuse theirs.
  const ctx = new AC();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(data.slice(0));
  } finally {
    ctx.close();
  }

  const mono = downmixToMono(decoded);
  if (decoded.sampleRate === TARGET_SAMPLE_RATE) return mono;
  return resample(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
}

function downmixToMono(buf: AudioBuffer): Float32Array<ArrayBuffer> {
  const len = buf.length;
  const out = new Float32Array(len);
  const ch = buf.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += d[i] / ch;
  }
  return out;
}

async function resample(input: Float32Array<ArrayBuffer>, fromRate: number, toRate: number): Promise<Float32Array> {
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const offline = new OfflineAudioContext(1, outLen, toRate);
  const src = offline.createBufferSource();
  const buf = offline.createBuffer(1, input.length, fromRate);
  buf.copyToChannel(input, 0);
  src.buffer = buf;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}
