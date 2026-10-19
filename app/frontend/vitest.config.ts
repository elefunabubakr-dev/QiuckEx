import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Use the automatic JSX runtime so React component tests transform without an
  // explicit `import React`. Individual component test files opt into the jsdom
  // environment via a `// @vitest-environment jsdom` docblock.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    minWorkers: 1,
    maxWorkers: 1,
    isolate: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
