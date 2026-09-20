import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // scripts/ holds the repository's own tooling. Only the pieces that decide
    // something are worth a unit test — review-surface.mjs measures how much
    // review a branch asks for (#923), gates.mjs decides which gates a change
    // asks for (#783) — and they are plain ESM run under node, which is this
    // project, not the browser one.
    include: ['src/**/*.test.ts', '../scripts/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
    },
  },
});
