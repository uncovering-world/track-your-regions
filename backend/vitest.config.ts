import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // scripts/ holds the repository's own tooling. Only the pieces that decide
    // something are worth a unit test — review-surface.mjs measures how much
    // review a branch asks for (#923), gates.mjs decides which gates a change
    // asks for (#783) — and they are plain ESM run under node, which is this
    // project, not the browser one.
    // packages/shared holds the rules both sides apply (ADR-0065). Its specs run
    // here for the same reason the tooling's do: the package ships source and
    // has no runner of its own, and this lane already reads the tree beside it.
    include: ['src/**/*.test.ts', '../scripts/**/*.test.mjs', '../packages/shared/src/**/*.test.ts'],
    // The database-backed specs (`*.db.test.ts`, #522) execute their statements
    // against a real PostgreSQL and belong to `vitest.db.config.ts`, which runs
    // only inside the isolated test stack. The include above matches them too,
    // so they are named here to keep them out of the two runs that have no
    // database — CI's Unit Tests job and the host lane — where they could only
    // fail, or skip and report green having run nothing. Spread over the
    // defaults: `exclude` replaces vitest's list, and that list is what keeps
    // node_modules out.
    exclude: [...configDefaults.exclude, 'src/**/*.db.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
    },
  },
});
