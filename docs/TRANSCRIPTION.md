# Audio → tab transcription

How fretwork turns audio into an editable tab. This is the detailed companion to the short overview in
[`ARCHITECTURE.md`](ARCHITECTURE.md#audio--tab-transcription).

> Built in collaboration with AI coding assistants (Claude). The calibration constants below were tuned
> against a captured clip, not a corpus — they're pragmatic, not optimal.

## What it is (and isn't)

You upload an audio file (or record from the mic), a note-detection model finds the notes, and fretwork
assembles them into a guitar tab that opens as a **new file** — from there it's an ordinary score, edited
through the same Command stack as anything imported.

- **Client-side, no upload.** Decoding, inference, and score-building all run in the browser. Nothing
  leaves the machine — which is exactly the local-first promise the rest of the app makes.
- **Monophonic.** The pipeline collapses the model's polyphonic output to a single line, loudest note
  wins. Feed it a chord progression and you get one note per beat. Chords are a possible future
  addition (the collapse already sets the discarded notes aside).
- **Experimental.** A real performance isn't metronomic and the model is noisy, so output needs cleanup.
  Tempo/grid/threshold controls exist precisely because no single setting is right for every clip.

Architecturally, transcription is a **score-creation path** — a sibling of `import.ts` and
`newScore.ts`. It produces a `Score`, mints a GP7 file, and opens it; it never touches the command core.

## The pipeline

```
File / Blob
   │  decodeToMono22050         (decode.ts — Web Audio, main thread)
   ▼
mono Float32Array @ 22050 Hz
   │  transcribe()              (workerClient.ts → worker.ts, off the main thread)
   ▼
NoteEventTime[]   ◀── basic-pitch + tfjs (WebGL)        (basicPitch.ts)
   │
   ├──▶ detectTempo()  ─────────────────▶  detected BPM   (detectTempo.ts)
   │
   │        ── user reviews / overrides BPM + grid in TranscribeModal ──
   ▼
quantize(notes, bpm, division)           (quantize.ts)   → monophonic grid timeline
   │
   ▼
assignFrets(midis)                       (fretAssign.ts) → string/fret per note
   │
   ▼
buildScoreFromNotes → alphaTex → Score   (buildScore.ts)
   │
   ▼
exportGp7Bytes → addFile → open as new tab   (transcribe.ts)
```

`transcribe.ts` orchestrates this and deliberately splits it in two so the UI can pause in the middle
(see [Two-phase: analyze, then build](#two-phase-analyze-then-build)).

## Stage by stage

### 1. Decode (`decode.ts`)

`decodeToMono22050(ArrayBuffer)` uses the Web Audio API to decode any browser-supported format
(mp3/wav/ogg/m4a/…), downmix to mono, and resample to **22050 Hz** — the sample rate basic-pitch
expects. Resampling goes through an `OfflineAudioContext`. This runs on the main thread because
`decodeAudioData` isn't reliable in a worker; everything after it operates on the plain `Float32Array`.

Both input sources converge here: an uploaded `File` and a mic `Blob` (`record.ts`,
`MediaRecorder` → `Blob`) are indistinguishable once decoded. There is no live/streaming inference — the
buffer is always complete before the model runs.

### 2. Inference (`basicPitch.ts`, in the worker)

Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch) model runs on
[`@tensorflow/tfjs`](https://github.com/tensorflow/tfjs) via its WebGL backend. `audioToNotes` runs the
model, applies the detection thresholds, and returns time-stamped note events:

```ts
NoteEventTime = { startTimeSeconds, durationSeconds, pitchMidi, amplitude, pitchBends? }
```

Tunable thresholds (`TranscribeOptions`, exposed in the UI; defaults in parentheses):

| Option | Meaning |
|---|---|
| `onsetThresh` (0.25) | onset confidence — higher = fewer, more confident note starts |
| `frameThresh` (0.25) | sustain confidence |
| `minNoteLen` (5) | minimum note length in frames (~11 ms each) |
| `minFreqHz` / `maxFreqHz` (null) | optional frequency band |
| `backend` (`webgl`) | tfjs backend; `wasm`/`cpu`/null also accepted |

The thresholds feed the model, so changing one requires re-running inference (unlike BPM/grid — see
below).

**Why a worker.** Inference takes seconds and would freeze the UI on the main thread. `worker.ts` runs
basic-pitch + tfjs off-thread; `workerClient.ts` is the main-thread side (a request/response protocol in
`workerProtocol.ts`, correlated by id). Vite bundles the worker as its own chunk, which is the
**lazy-load boundary**: tfjs and the model (~0.92 MB, in `public/transcribe-model/`) download only when
the transcribe panel first opens, never in the entry bundle.

**Cold start & warm-up.** The first run pays a model fetch + WebGL shader compile. `warm()` runs ~1 s of
silence through the model when the panel opens, so that cost is paid before the user hits Transcribe. A
single worker is reused for the page, so reopening the panel and running again is instant. One worker
quirk: tfjs guards on a bare `window` identifier (undeclared in a worker, which throws), so the worker
aliases `window` to its global before tfjs loads.

### 3. Tempo detection (`detectTempo.ts`)

Runs on the note events, not the audio, so it happens after inference. Handrolled inter-onset-interval
(IOI) clustering:

1. **Clean the onsets** the same way the quantizer does — amplitude floor, collapse near-simultaneous
   onsets (keep the loudest = the fundamental, since harmonics are quieter), merge consecutive
   same-pitch onsets (a held note re-onsets repeatedly).
2. **IOIs** between consecutive surviving onsets, ignoring intervals shorter than 0.2 s (collapse dust)
   or longer than 2.0 s (rests/phrase gaps).
3. **Fold** each interval into the 70–160 BPM beat-period band by doubling/halving — an eighth-note IOI
   and a two-beat IOI are octave aliases of the same tempo, and that band spans more than a factor of 2
   so every interval folds in.
4. **Cluster** the folded periods (adjacent values within ~6 % relative) and report the biggest
   cluster's mean as the BPM.

Returns `null` when the clip is too sparse or ambiguous to call (too few IOIs / no dominant cluster); the
caller falls back to 120 BPM and the UI override is the safety net. Tempo detection only sets the score's
tempo marking — note placement is the fixed-grid quantizer.

### 4. Quantize (`quantize.ts`)

Turns the free-floating, polyphonic note events into a **monophonic timeline of grid cells** (one cell =
1/`division` of a whole note at the given BPM). The grid is selectable — **8** (default), 16, or 32. The
default is coarse on purpose: a real performance isn't metronomic, and a finer grid faithfully renders
every few-ms onset jitter as an off-beat sixteenth, littering clean melodies with syncopation and ties.
An eighth grid rounds that jitter back onto the beat; 16/32 are there for genuinely fine playing.

The passes, in order:

0. **Pitch gate** — drop anything below MIDI 40 (the lowest standard-tuning open string). Sub-bass is
   unplayable and in practice is rumble / octave-error ghosts; dropping it early stops a stray low blip
   from anchoring the grid.
1. **Amplitude floor** — drop notes quieter than 30 % of the clip's loudest. Kills the weak "pre-onset"
   ghosts (~0.2 amp vs ~0.7 for real attacks) that precede a true onset.
2. **Collapse near-simultaneous onsets** (within 50 ms) to monophonic, loudest wins. Losers go to a
   `dropped` array (the seed for a future chord pass).
3. **Merge same-pitch segment chains** — the model slices one held note into back-to-back events; same
   pitch events that overlap or abut within ~30 ms are one note. A genuinely repeated note has real
   silence between plucks and stays two notes.
4. **Snap onsets and ends to the grid**, anchored so the first onset is cell 0 / beat 1 (leading mic
   silence never becomes rests). Every note keeps at least one cell.
5. **Monophonic cleanup on the grid** — two onsets rounded into one cell → loudest wins; a note still
   sounding when the next starts is truncated at the next onset.
6. **Gap fill** — a sub-beat gap before the next onset is the note's decay, not silence, so absorb it.
   basic-pitch reports duration only while the string clearly sounds, so notes "end" early; rendering
   every gap as a rest comes out staccato-littered. Trust onsets, distrust durations: only silences of a
   full beat or more survive as empty cells (rendered as rests).

Output is `PlacedNote[]` (`midi`, `startCell`, exclusive `endCell`), monophonic and non-overlapping, plus
the `dropped` events.

### 5. Fret assignment (`fretAssign.ts`)

One pitch maps to several string/fret positions; good tab minimizes fretting-hand movement. Rather than
pick each note's lowest fret in isolation (which scatters a phrase up and down the neck), `assignFrets`
runs a **Viterbi pass** over the whole melody and chooses the lowest-total-cost path.

The cost model is deliberately minimal (there's no fingering corpus to calibrate richer weights against):

- **Transition (dominant):** hand movement `|anchorFret − fret|` along the neck, plus a small
  per-string-crossing cost. Minimize movement first.
- **Emission:** a small open-string bonus and a faint nut-ward fret-height tie-breaker.

**Open strings and the anchor.** Plucking an open string doesn't move the hand, so an open note costs no
movement and doesn't reset the position — it inherits the last *fretted* fret as the anchor. This avoids
both charging a phrase for "travelling to fret 0 and back" and losing the hand position after an open
string (a hidden shift). Known limit: an open string *between* two distant fretted notes still hides that
real shift; rare and accepted.

Unplayable pitches (below the lowest open string, or above fret 24 on every string) return `null` and
become rests downstream; continuity bridges across such holes so the hand doesn't teleport.

String numbers here are **alphaTex** numbers (1 = high E … 6 = low E), because the only consumer is
`buildScore.ts`. alphaTab's internal `Note.string` is the inverse; the alphaTex importer converts.

### 6. Build the score (`buildScore.ts`)

Emits an **alphaTex** string and lets `AlphaTexImporter` construct the model — the same import
round-trip `newScore.ts` uses instead of hand-rolling the `Score` graph (verbose and easy to get subtly
wrong). The importer's default track is already a standard-tuning 6-string guitar, the target tuning, so
it only has to emit notes.

Rendering the cell timeline bar by bar:

- A run of cells becomes the fewest beats that sum to it, greedy largest-first, dotted values allowed
  (`{d}`; 6 cells on a 16th grid = one dotted quarter, not quarter + eighth).
- Empty cells become rests (`r.dur`).
- A note crossing a barline (or too lumpy for one beat) is split and tied — alphaTex writes a tie
  destination as a `-` fret (`0.5.4 | -.5.4`).
- Bars are 4/4 (no time-signature detection), separated by explicit `|` (alphaTex doesn't auto-wrap
  bars). The final bar is left underfull rather than padded with trailing rests.

alphaTex note syntax is `fret.string.duration` where `string` is the alphaTex string number and
`duration` is the denominator (4 = quarter). An empty / all-unplayable input yields a blank one-bar rest
so the caller always gets an openable score.

### 7. Open as a new tab (`transcribe.ts`)

`openNotesAsNewTab` exports the built `Score` to GP7 bytes (`exportGp7Bytes`), persists it as a new `.gp`
library file (`addFile`), and points the editor at it — indistinguishable from an imported file, so every
subsequent edit goes through the Command stack and autosave.

## Two-phase: analyze, then build

`transcribe.ts` exposes the pipeline as two functions so the UI can pause for review:

- **`analyzeClip(input, onProgress?, opts?)`** → `{ notes, detectedBpm }`. Runs the expensive decode +
  inference + tempo detection **once**, and caches the raw notes.
- **`openNotesAsNewTab(notes, name, bpm, division)`** → builds the score from the *cached* notes and
  opens it.

So changing the **BPM or grid** rebuilds the tab instantly without re-running the model — only changing a
**detection threshold** (which feeds the model) re-runs `analyzeClip`. `TranscribeModal` drives this:
inference → show the detected BPM for override → build. `transcribeToNewTab` is a one-shot convenience
(analyze + build at the detected BPM) kept for the dev hook.

## Module map

| File | Role |
|---|---|
| `transcribe.ts` | Orchestration; `analyzeClip` / `openNotesAsNewTab` / `transcribeToNewTab` |
| `decode.ts` | Audio → mono 22050 Hz Float32Array |
| `record.ts` | Mic capture (`MediaRecorder` → `Blob`) |
| `basicPitch.ts` | tfjs + basic-pitch wrapper, `warmUp` / `audioToNotes` (runs in the worker) |
| `worker.ts` / `workerClient.ts` / `workerProtocol.ts` | Off-main-thread inference + its message contract |
| `detectTempo.ts` | IOI-clustering BPM estimate |
| `quantize.ts` | Note events → monophonic grid timeline |
| `fretAssign.ts` | Viterbi string/fret assignment |
| `buildScore.ts` | Grid timeline → alphaTex → `Score` |
| `src/ui/TranscribeModal.tsx` | The UI: upload / record, thresholds, BPM + grid review |

## Known limitations

- **Monophonic** — chords collapse to their loudest note.
- **4/4 only** — no time-signature detection.
- **Tempo sets the marking only** — placement is the fixed grid, not detected micro-timing.
- **Calibration is small-sample** — the floors, windows, and grid default were tuned against a captured
  clip, not a corpus.
- Detection can return no tempo on sparse clips (falls back to 120 BPM).

## Testing

Unit tests run without the model:

- `test/transcribe/detectTempo.test.ts` and `buildScore.test.ts` exercise the deterministic stages
  against fixture note events (`test/transcribe/fixtures/sampleRawNotes.ts`).
- `test/transcribe/integration.model.test.ts` runs the **real** model (CPU backend + a filesystem
  IOHandler + manual WAV parsing) end-to-end on a synthetic fixture, catching a corrupt `model.json`, a
  tfjs version drift, or a changed basic-pitch signature. It's skipped by default (it loads tfjs and runs
  ~3 s of CPU inference); run it with `pnpm test:model` (sets `RUN_MODEL_TESTS=1`).

This Node harness is parallel to production, which is WebGL + a URL fetch + the Web Worker + Web Audio
decode — none of which run headless. The full real path is verified by a manual browser run.
