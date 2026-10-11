import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANES, loadsModules, readsText, selectSpecs } from './affected-specs.mjs';
import { backendSrc } from './repo-root.mjs';

const always = () => true;
const READERS = ['backend/src/db/regionFocusAntimeridian.test.ts', 'scripts/gates.test.mjs'];

const backend = (changed, exists = always) =>
  selectSpecs({ lane: 'test:backend', changed, exists, textReaders: READERS });
const web = (changed, exists = always) =>
  selectSpecs({ lane: 'test:frontend', changed, exists, textReaders: [] });

describe('the affected selection of a unit lane', () => {
  it('hands Vitest the changed modules and every spec that reads files as text', () => {
    const chosen = backend(['backend/src/services/sync/componentItemMatching.ts', 'scripts/gates.mjs']);
    expect(chosen.whole).toBe(false);
    // Relative to backend/, where the lane's Vitest runs.
    expect(chosen.targets).toEqual([
      '../scripts/gates.mjs',
      '../scripts/gates.test.mjs',
      'src/db/regionFocusAntimeridian.test.ts',
      'src/services/sync/componentItemMatching.ts',
    ]);
    expect(chosen.why).toContain('2 changed modules');
    expect(chosen.why).toContain('2 specs that read files as text');
  });

  it('reaches a spec through the text it reads when no import names the change', () => {
    // A real case the import graph misses: no backend spec imports the web's
    // map hook, and regionFocusAntimeridian.test.ts reads it as text to hold
    // the client to the stored frame (#674). The spec is selected anyway.
    const chosen = backend(['frontend/src/components/regionMap/useMapInteractions.ts']);
    expect(chosen.whole).toBe(false);
    expect(chosen.targets).toContain('src/db/regionFocusAntimeridian.test.ts');
    expect(chosen.why).toContain('which a change to the files they read asks for');
  });

  it('runs the whole lane for its configuration, setup, manifest or TypeScript settings', () => {
    for (const path of ['backend/vitest.config.ts', 'backend/package-lock.json', 'packages/shared/tsconfig.json', 'scripts/test-report.mjs']) {
      expect(backend([path]).whole, path).toBe(true);
    }
    for (const path of ['frontend/vite.config.ts', 'frontend/src/test/setup.ts', 'frontend/package.json']) {
      const chosen = web([path]);
      expect(chosen.whole, path).toBe(true);
      expect(chosen.why, path).toContain('configures every spec');
    }
  });

  it('runs the whole lane for a module that was deleted or moved', () => {
    const gone = 'backend/src/services/sync/old.ts';
    const chosen = backend([gone], (path) => path !== gone);
    expect(chosen.whole).toBe(true);
    expect(chosen.why).toContain('deleted or moved');
  });

  it('selects nothing for a web file no spec imports or reads', () => {
    // index.html is the web's, and no Vitest spec imports or reads it.
    const chosen = web(['frontend/index.html']);
    expect(chosen.whole).toBe(false);
    expect(chosen.targets).toEqual([]);
  });

  it('runs the whole lane for data a module reads at run time, which no graph follows', () => {
    // loadPricing() opens this CSV with readFileSync; pricingService.test.ts
    // imports the module, not the file, and reads nothing as text itself.
    const chosen = backend(['backend/src/data/openai_api_model_costs.csv']);
    expect(chosen.whole).toBe(true);
    expect(chosen.why).toContain('data a module may read at run time');
    // What a bundler imports beside code is followed.
    expect(web(['frontend/src/theme/base.css']).whole).toBe(false);
  });

  it('always runs the importers of a module loader, whose reach the graph cannot see', () => {
    // responseModules.ts lists api/responses/ and imports each file by path, so
    // a new response module reaches responseModules.test.ts through no import.
    const loaders = ['backend/src/api/responseModules.ts'];
    const chosen = selectSpecs({
      lane: 'test:backend',
      changed: ['backend/src/api/responses/newThing.ts'],
      exists: always,
      textReaders: [],
      loaders,
    });
    expect(chosen.targets).toEqual(['src/api/responseModules.ts', 'src/api/responses/newThing.ts']);
    expect(chosen.why).toContain('the importers of 1 module loader');
  });

  it('runs the whole lane for the container files, which no module or text read narrows', () => {
    expect(backend(['docker-compose.test.yml']).whole).toBe(true);
    expect(web(['.env.example']).whole).toBe(true);
  });

  it('names a web module and a runner script relative to the web lane', () => {
    const chosen = web(['frontend/src/components/curation/ReviewQueue.tsx', 'scripts/lighthouse-summary.mjs']);
    expect(chosen.whole).toBe(false);
    expect(chosen.targets).toEqual(['../scripts/lighthouse-summary.mjs', 'src/components/curation/ReviewQueue.tsx']);
  });

  it('ignores what the lane does not read, and the root manifest’s script entries', () => {
    const chosen = backend(['docs/tech/x.md', 'package.json#scripts/lint:md', 'backend/src/a.ts']);
    expect(chosen.whole).toBe(false);
    expect(chosen.targets).toContain('src/a.ts');
  });
});

describe('what makes a spec a text reader', () => {
  it('opens files rather than importing them', () => {
    expect(readsText("const doc = readFileSync(path, 'utf8');")).toBe(true);
    expect(readsText('const sql = repoFile(...segments);')).toBe(true);
    expect(readsText('const eslint = new ESLint({ cwd });')).toBe(true);
    expect(readsText("import { a } from './a';\nexpect(a()).toBe(1);")).toBe(false);
  });

  it('finds the real module loaders, and not a type written as import(...)', () => {
    for (const name of [join('api', 'responseModules.ts'), join('api', 'generateOpenApi.ts')]) {
      const file = join(backendSrc, name);
      if (!existsSync(file)) return; // a checkout without the backend's source
      expect(loadsModules(readFileSync(file, 'utf8')), name).toBe(true);
    }
    expect(loadsModules("type Cv = typeof import('opencv');\n// a dynamic import() through esbuild")).toBe(false);
  });

  it('holds for the real spec that reads the web’s map hook', () => {
    const file = join(backendSrc, 'db', 'regionFocusAntimeridian.test.ts');
    if (!existsSync(file)) return; // a checkout without the backend's source
    expect(readsText(readFileSync(file, 'utf8'))).toBe(true);
  });

  it('counts a lane’s specs by the same patterns its Vitest config runs', () => {
    expect(LANES['test:backend'].specs.test('backend/src/a/b.test.ts')).toBe(true);
    expect(LANES['test:backend'].specs.test('backend/src/a/b.db.test.ts')).toBe(false);
    expect(LANES['test:backend'].specs.test('scripts/gates.test.mjs')).toBe(true);
    expect(LANES['test:frontend'].specs.test('frontend/src/a/B.test.tsx')).toBe(true);
    expect(LANES['test:frontend'].specs.test('frontend/perf/assertions.test.mjs')).toBe(true);
  });
});
