import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Acceptance tests share one database and reset it per file.
    fileParallelism: false,
    testTimeout: 20000,
    // freshEnv (drop schema + all migrations) takes ~6 s on a Docker-on-Windows database and more during a checkpoint; 10 s was too tight.
    hookTimeout: 60000,
  },
});
