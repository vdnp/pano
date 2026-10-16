import { defineConfig } from 'vitest/config';

// Testler Electron olmadan düz Node'da çalışır; yalnızca core/ ve plugins/ test edilir.
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node'
  }
});
