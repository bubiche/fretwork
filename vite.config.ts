import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { alphaTab } from '@coderline/alphatab-vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the app from /fretwork/, so that stays the default. Self-hosted builds
  // (see the Dockerfile) override it — BASE_PATH=/ for a root-mounted deploy. Baked in at build
  // time: every runtime asset URL is derived from `import.meta.env.BASE_URL`.
  base: process.env.BASE_PATH ?? '/fretwork/',
  plugins: [preact(), alphaTab()],
  // The inference worker (src/transcribe/worker.ts) is spawned as a module worker and dynamic-imports
  // tfjs + basic-pitch, so its bundle must code-split. Vite's default worker.format ('iife') forbids
  // code-splitting; 'es' is required (and matches the `{ type: 'module' }` Worker we construct).
  worker: { format: 'es' },
})
