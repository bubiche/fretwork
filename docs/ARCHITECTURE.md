# Architecture

This document describes how fretwork is put together: the layers, the data flow, and the
hard-won constraints that shape the design. It reflects what's actually built.

> fretwork was built in collaboration with AI coding assistants (Claude). Many of the
> implementation notes below — especially the alphaTab-internals findings — were discovered and
> documented during that work.

## The one idea that matters

**Every edit is a `Command` with `apply(score)` and `undo(score)`. The UI never mutates the
alphaTab score directly.** Everything else follows from this.

A command mutates the live alphaTab `Score` in place and knows how to reverse itself. Commands run
through a single `HistoryRouter`, which applies them, pushes them onto an undo stack, re-renders,
and bumps a monotonic `scoreVersion` that the UI subscribes to. Undo and redo route back through the
same `apply`/`undo` pair, so history is symmetric by construction.

This keeps the editor core framework-independent and fully unit-testable: tests synthesize a `Score`,
run commands against it, and assert round-trip equality — no Preact, no DOM, no alphaTab renderer.

## Layers

```
┌────────────────────────────────────────────────────────────────┐
│  Preact UI  (light DOM only)                                    │
│   Sidebar · ScoreView · SelectionOverlay · Transport            │
│   EffectsPanel · ExportMenu · Tracks · KeyboardHelp             │
│   ScoreInfoBar · TranscribeModal                                │
│   — render + dispatch only; subscribe to store via useStore     │
└───────────────┬───────────────────────────┬────────────────────┘
                │ dispatch edits             │ read state
                ▼                            ▼
┌────────────────────────────────────────────────────────────────┐
│  Editor core  (framework-independent, unit-tested)             │
│   store          pub/sub state + useStore hook                  │
│   selection      BeatRef, range anchor, reValidateSelection     │
│   Command        apply / undo / describe / relayout             │
│   CommandStack   undo+redo, cap 200, observable                 │
│   HistoryRouter  execute/undo/redo/amend → render + version     │
│   ScoreMutator   ergonomic wrapper over the alphaTab Score      │
│   commands/      one class per edit type                        │
└───────────────┬───────────────────────────┬────────────────────┘
                │ mutate Score               │ persist bytes
                ▼                            ▼
┌──────────────────────────────┐   ┌────────────────────────────┐
│  alphaTab                    │   │  IndexedDB  (hand-rolled)  │
│   importer  (.gp → Score)    │   │   meta   (id, name, size)  │
│   renderer  (Score → SVG)    │   │   files  (raw bytes)       │
│   player    (synth + SF)     │   │                            │
│   Gp7/AlphaTex exporters     │   │                            │
└──────────────────────────────┘   └────────────────────────────┘
```

## The edit pipeline

Every model change flows through `HistoryRouter` (`src/editor/HistoryRouter.ts`):

1. **Dispatch.** A keypress (or panel control) calls a thin helper like `changeSelectedFret`, which
   builds a `Command` and calls `execute(cmd)`.
2. **Apply + push.** `CommandStack.execute` runs `cmd.apply(score)` against the live score (read on
   demand via an injected accessor) and pushes it, clearing the redo buffer.
3. **`afterMutation`.** The router then, in order:
   - Runs `score.finish(settings)` **only if** the command's `relayout` is `'voice'`/`'score'`
     (structural/tick-changing edits need it to reindex beats, re-chain, and regroup beams; plain
     value edits use `'none'` and skip it).
   - Re-validates the selection against the possibly-restructured score (`reValidateSelection`).
   - Calls `api.render()`.
   - Schedules a **debounced** `loadMidiForScore()` (400 ms) so playback audio reflects the edit —
     alphaTab generates synth MIDI once at load, separate from the visual render path, so edits
     would otherwise be seen but not heard.
   - Bumps `scoreVersion` and mirrors `canUndo`/`canRedo` into the store.
4. **React.** Components subscribed to `scoreVersion` (or other slices) via `useStore` re-render.

Undo, redo, and the multi-digit fret "amend" (re-applying the top command in place without pushing a
new entry) all funnel through the same `afterMutation`, so the rendered + audible state always
matches the model regardless of how it got there.

### `Command.relayout`

Each command declares how aggressively the renderer must rebuild:

- `'none'` (default) — value/note edits (`ChangeFret`, `ChangeString`, `AddNote`, `DeleteNote`,
  `BeatToRest`). A bare `api.render()` picks these up.
- `'voice'` / `'score'` — structural or tick-changing edits (`ChangeDuration`, `Insert`/`DeleteBeat`,
  measure insert/delete, time/key-sig, tempo). These force `score.finish()` first.

`relayout` lives on the command (not as an `execute()` argument) precisely so undo/redo lay out
identically to the original edit.

## Core modules

- **`store.ts`** — a ~30-line pub/sub store plus the `useStore` hook. Holds `scoreVersion`,
  `selection`/`anchor`/`selectedString`, transport, tracks, view (zoom/layout), file list, and
  `canUndo`/`canRedo`. Non-serializable handles (the `AlphaTabApi`, the command stack) are kept
  outside the serializable state. Subscriptions are selector-based: a listener only fires when its
  selected slice changes by identity.
- **`selection.ts`** — the `BeatRef` (`track/staff/voice/bar/beat`) coordinate, the always-on
  single-beat selection model, and range selection via an `anchor` (fixed end) + `selection`
  (moving focus), constrained to a single track/staff/voice. `reValidateSelection` clamps an
  index-based `BeatRef` back into bounds after a structural edit or its undo.
- **`CommandStack.ts`** — the undo/redo stacks (cap `STACK_CAP = 200`, oldest dropped on overflow).
  Self-contained: it runs `apply`/`undo` itself against a `getScore()` accessor, so it has no
  dependency on alphaTab or the store and is unit-tested against a synthesized `Score`.
- **`HistoryRouter.ts`** — the singleton that wraps the stack with rendering, selection
  re-validation, MIDI regen, and store updates (see the pipeline above).
- **`ScoreMutator.ts`** — the ergonomic layer over alphaTab's `Score` model that commands build on
  (resolving a `BeatRef` to a `Beat`/`Note`, editing frets/durations, adding/removing notes and
  beats, and rebuilding structural links).
- **`commands/`** — one class per edit type, grouped into `effects/` and `structural/`
  subdirectories. Each pairs an `apply` with an `undo` and sets its `relayout`.
- **`snapshot.ts`** — `scoreSnapshot`, a hand-rolled "touchable-fields" tree used by tests to assert
  apply→undo round-trip equality. (It is **not** a byte-identical export; true file fidelity is
  verified separately against real fixture files.)

## alphaTab integration notes

A single `AlphaTabApi` instance is created in `src/alphatab/api.ts` with:

- `core.includeNoteBounds: true` — so the selection overlay can anchor to the exact note-head
  rectangle. A beat's `visualBounds` spans both the notation and tab staves, so string rows can't be
  derived from its height.
- `player.enableUserInteraction: false` — alphaTab's built-in click handling is disabled; selection
  is driven entirely by our own keyboard/mouse routing.
- `enableCursor` + `scrollElement` for playback cursor-follow.

Three findings about alphaTab internals are load-bearing and easy to regress:

1. **A beat is rendered once per staff.** `boundsLookup.findBeat(beat)` returns only the first
   (notation) staff, whose note positions are placed by pitch, not string. To anchor to the **tab**
   staff, use `findBeats(beat)` and pick the entry with the largest `visualBounds.y` (tab renders
   below notation; whole staves don't overlap, so max-y is unambiguous). Its `.notes` are the fret
   digits keyed by string.
2. **`score.finish()` does not rebuild bar/masterbar indices or chain links.** alphaTab sets
   `Bar.index`/`MasterBar.index` and the `previous`/`next` chains only at *add* time, and its own
   structural maintenance only ever appends/pops at the end — never splices mid-array. After an
   insert/delete-measure splice, a stale index leaves `Bar.masterBar` (a getter indexing
   `score.masterBars[this.index]`) pointing out of bounds, crashing `finish()`. `ScoreMutator`'s
   `relinkStructure()` rebuilds indices + chains inside command `apply`/`undo`, before `finish()`.
3. **The render worker re-links notes by id.** alphaTab serializes the score to its render worker,
   which re-links ties/slurs/HOPOs/slides **by note id**. A linked effect whose partner is dropped
   (paste) or deleted (cut/replace) leaves a dangling id pointer and crashes the worker. The
   clipboard/delete paths sever such links symmetrically and re-assign unique ids
   (`commands/structural/linkSurgery.ts`).

## Audio → tab transcription

`src/transcribe/` turns audio into an editable tab. Architecturally it is a **score-creation path**, a
sibling of `import.ts` and `newScore.ts`: it mints a real GP7 file and opens it as a new tab, so
everything downstream — rendering, autosave, and every subsequent edit through the Command stack — is
identical to an imported file. Nothing here touches the command core; it only *produces* a `Score`.

The pipeline (`transcribe.ts` orchestrates it):

```
File/Blob ─▶ decode (mono 22050 Hz) ─▶ [worker] basic-pitch + tfjs ─▶ note events
          ─▶ detectTempo (BPM)  ─┐
                                 ├─▶ quantize (grid) ─▶ assignFrets ─▶ alphaTex ─▶ Score ─▶ GP7 ─▶ new tab
   user reviews BPM / grid ──────┘
```

It is split into two halves so the UI can pause between them. `analyzeClip` runs the expensive
inference once and returns the raw note events **plus** a detected BPM; the user reviews/overrides the
BPM and grid in `TranscribeModal`; then `openNotesAsNewTab` builds the score from the *cached* notes —
changing the BPM or grid rebuilds the tab without re-running the model. (The detection thresholds are
the exception: they feed the model, so changing one re-runs `analyzeClip`.)

Two architectural facts matter here:

- **The Web Worker is the lazy-load boundary.** Inference runs off the main thread
  (`worker.ts` / `workerClient.ts`) so the UI never freezes during the seconds-long model run. Vite
  bundles the worker into its own chunk, so tfjs + basic-pitch (the heavy deps, plus the ~0.92 MB
  model) download only when the user first opens the transcribe panel — never in the entry bundle.
- **It's a score-creation path, not a command.** Output is just a `Score` opened as a new file, so
  everything downstream is the ordinary edit/render/autosave flow.

The signal processing in between — `detectTempo` (IOI clustering), `quantize` (monophonic grid
placement), `fretAssign` (Viterbi position assignment), `buildScore` (alphaTex round-trip) — is
documented stage by stage in [`docs/TRANSCRIPTION.md`](TRANSCRIPTION.md).

## SoundFonts

The synth's soundfont is selectable (`src/editor/soundfont.ts`, `src/alphatab/soundfonts.ts`). The
default is **Sonivox** (a general-MIDI bank, `sonivox.sf3`, ~1 MB), loaded on every score. The
**Classical Guitar** font (`classical_guitar.sf2`, ~19 MB) is opt-in: fetched lazily only when
selected and **layered on top of** Sonivox, never replacing it.

Two alphaTab-synth findings make this work:

1. **Presets resolve last-import-wins.** The synth searches loaded fonts in reverse, so loading the
   classical font *after* Sonivox makes guitar programs hit it while bass/drums/metronome fall back to
   the GM bank. `syncSoundFont` loads the first font with `loadSoundFont(bytes, false)` (replace) and
   the rest with `true` (append), and is safe to call on every `midiLoaded` — it no-ops when the choice
   is already applied or the player isn't created yet.
2. **The synth matches presets by exact bank+program, no fallback.** The classical font ships its one
   instrument at program 0, so a guitar track on GM program 24/25 would be silent. `src/alphatab/sf2.ts`
   does minimal SF2 binary surgery — cloning the preset header onto the GM guitar programs in memory
   (sample data untouched) — so guitar tracks actually sound. The shipped file on disk is left pristine.

## Persistence

`src/persistence/` is a thin layer, kept out of the editor core:

- **`db.ts`** — a hand-rolled IndexedDB wrapper (no `idb` dependency): two object stores, `meta`
  (id/name/size/timestamps) and `files` (raw bytes).
- **`autosave.ts`** — debounced (1 s) **overwrite-in-place** of the current score's GP7 bytes after
  edits, with a flush-on-file-switch so the outgoing file is saved before the score is swapped.
- **`import.ts`** — loads dropped/picked files (Guitar Pro `.gp`/`.gp3`–`.gp8`/`.gpx`, MusicXML
  `.musicxml`/`.mxl`/`.xml`, Capella `.capx`/`.cap`, alphaTex `.alphatab` — all import to the same
  `Score` model) into IndexedDB and the editor.
- **`export.ts`** + **`ExportMenu.tsx`** — manual "Export as…" to **Guitar Pro 7 (`.gp`)** via
  `Gp7Exporter` (full fidelity for guitar effects) or **alphaTex (`.alphatab`)** via
  `AlphaTexExporter`. There is no MusicXML/Capella exporter, so a non-GP import exports as `.gp` or
  `.alphatab`, not back to its original format.
- **`newScore.ts`** — creates a blank score.
- **`seedExample.ts`** — on a first-ever visit with an empty library, imports the bundled example tab
  from `public/` so the editor opens with something to look at. Gated by a once-per-browser
  localStorage flag, so deleting the example sticks across reloads. Once seeded it's an ordinary
  library file.

Note: the GP7 binary path is the durable format. There is no in-bundle JSON serializer fallback —
alphaTab's `JsonConverter` is not exported from the runtime entry point — so the clipboard and
autosave both use GP7 bytes, not JSON.

## Input

`src/input/keyboard.ts` is a global `document` keydown router that ignores events from
inputs/textareas/contenteditable. `src/input/shortcuts.ts` holds the key map and is the single
source of truth rendered by the `KeyboardHelp` legend, so the on-screen help never drifts from the
actual bindings.

## Testing

Vitest, unit only. The strategy centers on the command contract:

- **Per-command** apply/undo round-trip tests.
- **A property harness** (`roundtrip.property.test.ts`) that generates random interleaved command
  sequences, applies them, then runs redo-all + undo-all and asserts the score returns to its
  original snapshot, with a tripwire that the edits were non-trivial. New commands must be wired into
  its generator array to be covered.
- **Fixture tests** against small real `.gp` files that pin the effect value scales (bends, whammy,
  harmonics) and clipboard/export fidelity.

What's deliberately not tested: Preact UI components (visual review is cheaper) and alphaTab itself.

## Deployment

A push to `main` runs `.github/workflows/deploy.yml`: `pnpm install --frozen-lockfile`, `pnpm build`,
then publish `dist/` to GitHub Pages via `actions/upload-pages-artifact` + `actions/deploy-pages`.
Audio works without cross-origin isolation, so no `coi-serviceworker` is shipped.
