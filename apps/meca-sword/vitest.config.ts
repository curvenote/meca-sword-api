import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./app', import.meta.url)) } },
  test: {
    globalSetup: './tests/global-setup.ts',
    // One database, so test files run one at a time
    fileParallelism: false,
  },
});
