# fretwork

Personal web app for reading, playing, and editing Guitar Pro files.

Built on [alphaTab](https://github.com/CoderLine/alphaTab) for parsing, rendering, and playback; the editing layer is the custom build on top.

## What it does

- **Read** GP3–GP8 files (plus MusicXML, Capella, and alphaTex — anything alphaTab imports), rendering standard notation + guitar tab.
- **Play** back via MIDI + a bundled SoundFont, with transport controls (play/pause, stop, tempo, count-in, metronome) and a cursor that follows the music.
- **Edit** with an always-on, single-beat keyboard model — no modes:
  - Note-level: fret (type 0–24), string, duration, add/delete notes, insert/delete beats.
  - Effects: bends, slides, hammer-ons/pull-offs, let-ring, palm mute, vibrato, ghost/dead/tied notes, dynamics, tremolo picking, tremolo bar (whammy), tapping, harmonics, grace notes, and named chord diagrams.
  - Structural: time-signature and key-signature changes, tempo markers, insert/delete measures, and copy/paste/cut of beat ranges.
  - Every edit is undoable, and playback re-renders to match.
- **Save & export** — auto-saves to the browser (IndexedDB) after every edit, and exports to Guitar Pro 7 (`.gp`) or alphaTex (`.alphatab`).

It's a **local-first personal tool**: no accounts, no server, no multi-user. Everything lives in your browser.

## Tech stack

| Layer | Choice |
|---|---|
| Build | [Vite](https://vite.dev) (pinned to 7.x) |
| UI | [Preact](https://preactjs.com) + TypeScript (strict) |
| Notation / playback | [`@coderline/alphatab`](https://github.com/CoderLine/alphaTab) |
| State | A small hand-rolled pub/sub store + `useStore` hook (no external state lib) |
| Persistence | IndexedDB, accessed through a hand-rolled wrapper (no `idb`) |
| Styling | Vanilla CSS |
| Tests | [Vitest](https://vitest.dev) (unit only) |
| Deploy | GitHub Actions → GitHub Pages |

## Getting started

Requires the versions pinned in `.tool-versions` (Node 24, pnpm 11). The project ships its own `.npmrc` pointing at the public npm registry.

```sh
pnpm install
pnpm dev          # Vite dev server on http://localhost:5173
```

Drag a `.gp` file onto the window (or use the sidebar) to load it. A sample file ships in `public/`.

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

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes the static site to GitHub Pages via the official `actions/deploy-pages` flow.

## A note on how this was built

fretwork was built with substantial help from AI coding assistants — the architecture, much of the implementation, and the tests were developed in collaboration with Claude. It's a personal project and an experiment in that workflow as much as a guitar-tab editor.
