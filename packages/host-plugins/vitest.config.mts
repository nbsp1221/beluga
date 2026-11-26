import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These tests start native tools and load Pi in cold workers.
    testTimeout: 15_000,
    // Host fixtures open several SQLite stores on each of the four-core Windows CI runners.
    maxWorkers: process.env.CI && process.platform === 'win32' ? 2 : undefined,
  },
});
