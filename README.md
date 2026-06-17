# fretwork

Personal web app for reading, playing, and editing Guitar Pro files.

Built on [alphaTab](https://github.com/CoderLine/alphaTab) for parsing, rendering, and playback; the editing layer is the custom build on top.

## What it does

- **Read** GP3–GP8 files (plus MusicXML, Capella, and alphaTex — anything alphaTab imports), rendering standard notation + guitar tab.
- **Play** back via MIDI + bundled SoundFonts, with transport controls (play/pause, stop, tempo, count-in, metronome) and a cursor that follows the music. Pick between a general-MIDI bank (Sonivox) and a dedicated classical-guitar soundfont.
- **Edit** with an always-on, single-beat keyboard model — no modes:
  - Note-level: fret (type 0–24), string, duration, add/delete notes, insert/delete beats.
  - Effects: bends, slides, hammer-ons/pull-offs, let-ring, palm mute, vibrato, ghost/dead/tied notes, dynamics, tremolo picking, tremolo bar (whammy), tapping, harmonics, grace notes, and named chord diagrams.
  - Structural: time-signature and key-signature changes, tempo markers, insert/delete measures, and copy/paste/cut of beat ranges.
  - Title / artist edits to the rendered score header.
  - Every edit is undoable, and playback re-renders to match.
- **Transcribe** audio to tab — upload an audio file (or record from the mic), and a note-detection model turns it into an editable tab opened as a new file. Detects tempo and quantizes onto a note grid; thresholds and BPM are adjustable before the tab is created. **Experimental and monophonic** — it transcribes single-line melodies (simultaneous notes collapse to the loudest), and results need cleanup. Runs entirely in your browser: no upload, no server.
- **Save & export** — auto-saves to the browser (IndexedDB) after every edit, and exports to Guitar Pro 7 (`.gp`) or alphaTex (`.alphatab`).

It's a **local-first personal tool**: no accounts, no server, no multi-user. Everything lives in your browser.

## Tech stack

| Layer | Choice |
|---|---|
| Build | [Vite](https://vite.dev) (pinned to 7.x) |
| UI | [Preact](https://preactjs.com) + TypeScript (strict) |
| Notation / playback | [`@coderline/alphatab`](https://github.com/CoderLine/alphaTab) |
| Audio → tab | [`@spotify/basic-pitch`](https://www.npmjs.com/package/@spotify/basic-pitch) on [`@tensorflow/tfjs`](https://github.com/tensorflow/tfjs) (WebGL), run in a Web Worker |
| State | A small hand-rolled pub/sub store + `useStore` hook (no external state lib) |
| Persistence | IndexedDB, accessed through a hand-rolled wrapper (no `idb`) |
| Styling | Vanilla CSS |
| Tests | [Vitest](https://vitest.dev) (unit only) |
| Deploy | GitHub Actions → GitHub Pages |

## Bundled assets

**Note-detection model.** Audio-to-tab transcription runs Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch) model entirely in the browser — no server, no upload. The TensorFlow.js weights in `public/transcribe-model/` (`model.json` + `group1-shard1of1.bin`, ~0.92 MB) are copied verbatim from the [`@spotify/basic-pitch`](https://www.npmjs.com/package/@spotify/basic-pitch) npm package (v1.0.1, Apache-2.0); inference runs on [`@tensorflow/tfjs`](https://github.com/tensorflow/tfjs) via its WebGL backend, off the main thread in a Web Worker so the UI never freezes. The heavy deps and the model load lazily (dynamic `import()`), so they stay out of the initial bundle and download only when you first open the transcribe panel.

**SoundFonts.** Playback ships with a general-MIDI bank, **Sonivox** (`public/soundfont/sonivox.sf3`, ~1 MB), loaded by default. A dedicated **Classical Guitar** soundfont (`classical_guitar.sf2`, ~19 MB) is opt-in: it's fetched lazily only when selected and layered over Sonivox so guitar tracks use it while everything else (bass, drums, metronome) falls back to the GM bank. See `public/soundfont/` for licenses.

## Getting started

Requires the versions pinned in `.tool-versions` (Node 24, pnpm 11). The project ships its own `.npmrc` pointing at the public npm registry.

```sh
pnpm install
pnpm dev          # Vite dev server on http://localhost:5173
```

On a first visit the editor opens with a bundled example tab. Drag a `.gp` file onto the window (or use the sidebar) to load your own; sample files ship in `public/`.

### Scripts

```sh
pnpm dev          # dev server (with --force)
pnpm build        # type-check + production build → dist/
pnpm preview      # serve the built dist/ locally
pnpm test         # run the Vitest suite once
pnpm typecheck    # tsc -b --noEmit
```

## Architecture

The load-bearing idea: **every edit is a `Command` with `apply` / `undo`**, and the UI never mutates the alphaTab score directly. The editor core (commands, command stack, selection model, score mutator) is framework-independent and unit-tested; Preact only renders and dispatches.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture, and
[`docs/TRANSCRIPTION.md`](docs/TRANSCRIPTION.md) for how the audio→tab pipeline works stage by stage.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes the static site to GitHub Pages via the official `actions/deploy-pages` flow.

## A note on how this was built

fretwork was built with substantial help from AI coding assistants — the architecture, much of the implementation, and the tests were developed in collaboration with Claude. It's a personal project and an experiment in that workflow as much as a guitar-tab editor.
