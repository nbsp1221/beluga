import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These tests start native tools and load Pi in cold workers.
    testTimeout: 15_000,
  },
});
