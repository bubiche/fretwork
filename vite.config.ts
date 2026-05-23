import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { alphaTab } from '@coderline/alphatab-vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/fretwork/',
  plugins: [preact(), alphaTab()],
})
