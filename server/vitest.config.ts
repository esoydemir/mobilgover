import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Acceptance tests share one database and reset it per file.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
