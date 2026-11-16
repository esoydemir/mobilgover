import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The camera screen's decoder lives in mobile/ and is tested here; resolve its dependency from this package so CI needs no mobile install.
  resolve: { alias: { jsqr: fileURLToPath(new URL('./node_modules/jsqr', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts'],
    // Acceptance tests share one database and reset it per file.
    fileParallelism: false,
    testTimeout: 20000,
    // freshEnv (drop schema + all migrations) takes ~6 s on a Docker-on-Windows database and more during a checkpoint; 10 s was too tight.
    hookTimeout: 60000,
  },
});
