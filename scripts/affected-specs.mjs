/**
 * Which specs of a Node unit lane a change reaches (#1376).
 *
 * Vitest finds the specs that import a changed module, directly or not
 * (`vitest related`). Some specs sit outside that graph, and the selection
 * answers for them itself:
 *
 * - a spec that reads repository files as text — `repoFile()`, `readFileSync`,
 *   a directory walk, an ESLint run over the source. They are cheap next to the
 *   lane, and they are added whenever the lane runs at all, since a scan reads
 *   files no import names;
 * - the importers of a module loader, which loads modules by a computed path
 *   (`api/responseModules.ts` lists `api/responses/` and imports each file):
 *   the graph cannot see which modules it reaches, so the loader is added
 *   whenever the lane runs, as the text readers are;
 * - a spec whose behaviour is its lane's configuration — the Vitest config, the
 *   setup file, the manifest and lockfile, the TypeScript settings, and the
 *   runner the lane goes through. A change there runs the whole lane.
 *
 * A file a module reads at run time rather than imports — a CSV under the
 * lane's trees, say, which `loadPricing()` opens — is something no graph
 * follows either, and a change to one runs the whole lane. So does a compose
 * file, which shapes the lane's container, and a module deleted or moved, whose
 * importers the graph can no longer find.
 *
 * What is left is followed: a changed module through the graph, a file read by
 * a spec through that spec. So a change whose selection is empty — only
 * `frontend/index.html`, say, which no Vitest spec imports or reads — reaches
 * no spec, and the lane says so rather than running whole. The selection only
 * ever narrows the host run: CI runs every lane whole.
 */

/**
 * The two Node lanes. `roots` are the trees whose modules the lane's specs
 * import, so a change there is the graph's to follow; `config` the files that
 * shape every spec; `specs` what the lane runs, for the count it reports.
 * Paths are repository-relative; `dir` is where the lane's Vitest runs.
 */
export const LANES = {
  'test:backend': {
    dir: 'backend',
    roots: ['backend/src/', 'scripts/', 'packages/shared/src/'],
    config: [
      // The lane's own runner: a change to it is tested only by running the
      // lane through it whole.
      'scripts/test-report.mjs',
      'backend/vitest.config.ts',
      'backend/package.json',
      'backend/package-lock.json',
      'backend/tsconfig.json',
      'packages/shared/package.json',
      'packages/shared/tsconfig.json',
    ],
    specs: /^(?:backend\/src\/.*(?<!\.db)\.test\.ts|scripts\/.*\.test\.mjs|packages\/shared\/src\/.*\.test\.ts)$/,
    // Read as text by the lane's own specs (`repoFile()` and the tree scans),
    // never imported: a change there reaches the specs that read text.
    textTrees: ['db/', 'martin/', 'frontend/src/', 'docs/tech/gates.md', '.github/workflows/ci.yml', 'package.json'],
  },
  'test:frontend': {
    dir: 'frontend',
    roots: ['frontend/src/', 'frontend/perf/', 'frontend/tests/', 'packages/shared/src/', 'scripts/'],
    config: [
      'scripts/test-report.mjs',
      'frontend/vite.config.ts',
      'frontend/src/test/setup.ts',
      'frontend/package.json',
      'frontend/package-lock.json',
      'frontend/tsconfig.json',
      'frontend/tsconfig.node.json',
      'packages/shared/package.json',
      'packages/shared/tsconfig.json',
    ],
    specs: /^(?:frontend\/src\/.*\.test\.tsx?|frontend\/(?:perf|tests)\/.*\.test\.mjs)$/,
    textTrees: [],
  },
};

/** What makes a spec a text reader: it opens files rather than importing them. */
const READS_TEXT = /readFileSync|readdirSync|readFile\b|globSync|repoFile\(|backendSrc|new ESLint/;

/** Whether a spec's source reads repository files as text. */
export const readsText = (source) => READS_TEXT.test(source);

/**
 * What makes a module a loader: it imports other modules by a computed path
 * (`await import(pathToFileURL(join(RESPONSES, file)).href)`), so the graph
 * cannot see which modules its importers reach.
 */
const LOADS_MODULES = /\bawait\s+import\(\s*[A-Za-z_$]/;

/** Whether a module's source loads other modules by a computed path. */
export const loadsModules = (source) => LOADS_MODULES.test(source);

/**
 * The files the import graph follows: code, and what a bundler imports beside
 * it. Anything else under a lane's trees — a CSV, an SQL file, a fixture — is
 * data a module may read at run time, which no graph can follow.
 */
const FOLLOWED = /\.(?:[cm]?[jt]sx?|css|scss|svg|png|jpe?g|webp|gif|json)$/;

const under = (prefixes, path) => prefixes.some((prefix) =>
  (prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix));

/**
 * The selection for one lane. Pure: the caller says which paths changed, which
 * of them still exist, and which specs read text.
 *
 * Returns `{ whole: true, why }`, or `{ whole: false, targets, why }` where
 * `targets` are the paths to hand `vitest related`, relative to the lane's
 * directory — the changed modules of its trees and every text-reading spec.
 * Empty targets mean no spec of the lane reaches the change.
 */
export function selectSpecs({ lane, changed, exists, textReaders, loaders = [] }) {
  const spec = LANES[lane];
  const own = changed.filter((path) => !path.includes('#'));

  const config = own.find((path) => spec.config.includes(path));
  if (config) return { whole: true, why: `${config} configures every spec of the lane` };

  const read = readChanges(spec, own, exists);
  if (read.whole) return read;
  const { modules, textChanged } = read;
  // The compose files shape the lane's container rather than any module or
  // text a spec reads, so no selection can answer for them.
  const container = own.find((path) => CONTAINER_FILES.includes(path));
  if (container) {
    return { whole: true, why: `${container} shapes the lane's container, which no spec can be singled out for` };
  }

  const readers = textReaders.filter((path) => spec.specs.test(path));
  // A loader's importers run whenever the lane does, as the text readers do:
  // which modules it loads is a directory listing, not an import, so no change
  // can be traced to them.
  const loading = loaders.filter((path) => under(spec.roots, path));
  const relative = [...new Set([...modules, ...readers, ...loading])]
    .map((path) => relativeTo(spec.dir, path))
    .sort();
  return { whole: false, targets: relative, why: selectionWhy(modules, readers, loading, textChanged) };
}

/**
 * The changed modules of the lane's trees and whether a file its text readers
 * read changed — or the whole lane, for a module the graph cannot follow: one
 * deleted or moved, or data a module reads at run time.
 */
function readChanges(spec, own, exists) {
  const modules = [];
  let textChanged = false;
  for (const path of own) {
    if (under(spec.roots, path)) {
      if (!exists(path)) return { whole: true, why: `${path} was deleted or moved, so the graph cannot find its importers` };
      if (!FOLLOWED.test(path)) {
        return { whole: true, why: `${path} is data a module may read at run time, which the import graph cannot follow` };
      }
      modules.push(path);
    } else if (under(spec.textTrees, path)) {
      textChanged = true;
    }
  }
  return { modules, textChanged };
}

/** What a selection is made of, in words. */
function selectionWhy(modules, readers, loading, textChanged) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return [
    `${plural(modules.length, 'changed module')} of the lane's trees`,
    `${plural(readers.length, 'spec')} that read files as text`
      + (textChanged ? ', which a change to the files they read asks for' : ''),
    ...(loading.length ? [`the importers of ${plural(loading.length, 'module loader')}`] : []),
  ].join(', and ');
}

/**
 * The paths outside a lane's trees that it still reads: the compose files
 * shape its container, and they are the one such input the map gives both
 * lanes. Anything else outside the trees is another gate's.
 */
const CONTAINER_FILES = ['docker-compose.yml', 'docker-compose.test.yml', '.env.example'];

/** A repository path as the lane's Vitest, run from `dir`, names it. */
function relativeTo(dir, path) {
  return path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : `../${path}`;
}
