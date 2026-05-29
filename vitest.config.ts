import { defineConfig } from 'vitest/config'

// Standalone from vite.config.ts on purpose: the app build pulls in the alphaTab
// vite plugin (asset copying, worker transforms) which the Slice C unit tests don't
// need. These specs are pure model/logic — node environment, no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
