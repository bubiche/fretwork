import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { alphaTab } from '@coderline/alphatab-vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/fretwork/',
  plugins: [preact(), alphaTab()],
  // The inference worker (src/transcribe/worker.ts) is spawned as a module worker and dynamic-imports
  // tfjs + basic-pitch, so its bundle must code-split. Vite's default worker.format ('iife') forbids
  // code-splitting; 'es' is required (and matches the `{ type: 'module' }` Worker we construct).
  worker: { format: 'es' },
})
