import { describe, expect, it } from 'vitest';
import {
  SURFACE_BUDGET,
  areaOf,
  classifyFile,
  measureSurface,
  parseArgs,
  substitutionOf,
} from './review-surface.mjs';

/**
 * One file's worth of unified diff at `--unified=0`, the shape the measure is
 * given by `git diff -M --unified=0`. Written out rather than generated from a
 * repository so each test states the exact input its claim rests on.
 */
function fileDiff(path, hunks) {
  const body = hunks
    .map(({ deleted = [], added = [] }) =>
      ['@@ -1 +1 @@', ...deleted.map((l) => `-${l}`), ...added.map((l) => `+${l}`)].join('\n'),
    )
    .join('\n');
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, body].join('\n');
}

const diff = (...files) => `${files.join('\n')}\n`;

describe('what counts as a line', () => {
  it('counts a changed line of code once per side', () => {
    const measured = measureSurface(
      diff(fileDiff('backend/src/a.ts', [{ deleted: ['const a = 1;'], added: ['const a = 2;'] }])),
    );
    expect(measured.code).toBe(2);
    expect(measured.surface).toBe(2);
  });

  it('ignores blank lines and comment-only lines, as the file-size linter does', () => {
    const measured = measureSurface(
      diff(
        fileDiff('backend/src/a.ts', [
          {
            added: [
              '',
              '   ',
              '// why this exists',
              '/* a block */',
              ' * a continuation',
              '# a shell comment',
              '-- a SQL comment',
              '<!-- a markup comment -->',
              'const kept = true;',
            ],
          },
        ]),
      ),
    );
    expect(measured.code).toBe(1);
  });

  it('does not count generated output at all', () => {
    const generated = ['package-lock.json', 'frontend/src/__snapshots__/x.snap', 'poetry.lock', 'backend/src/db/schema.generated.ts'];
    for (const path of generated) {
      const measured = measureSurface(diff(fileDiff(path, [{ added: ['"resolved": "https://x"'] }])));
      expect(measured.surface, path).toBe(0);
      expect(measured.generated, path).toBe(1);
    }
  });

  it('weighs prose at a half and a migration at a quarter', () => {
    const prose = Array.from({ length: 10 }, (_, i) => `A sentence number ${i}.`);
    const sql = Array.from({ length: 8 }, (_, i) => `ALTER TABLE t${i} ADD COLUMN c int;`);
    const measured = measureSurface(
      diff(fileDiff('docs/tech/x.md', [{ added: prose }]), fileDiff('db/migrations/060-x.sql', [{ added: sql }])),
    );
    expect(measured.docs).toBe(10);
    expect(measured.migration).toBe(8);
    expect(measured.surface).toBe(5 + 2);
  });
});

describe('lines that only moved', () => {
  it('pairs a deletion in one file against the same line added in another', () => {
    const body = ['export function run(input) {', '  return input.map(step);', '}'];
    const measured = measureSurface(
      diff(
        fileDiff('backend/src/big.ts', [{ deleted: body }]),
        fileDiff('backend/src/run.ts', [{ added: body }]),
      ),
    );
    expect(measured.moved).toBe(6);
    expect(measured.code).toBe(0);
    expect(measured.surface).toBe(0);
  });

  it('leaves a line that was changed on the way, not just moved', () => {
    const measured = measureSurface(
      diff(
        fileDiff('backend/src/big.ts', [{ deleted: ['return input.map(step);'] }]),
        fileDiff('backend/src/run.ts', [{ added: ['return input.flatMap(step);'] }]),
      ),
    );
    expect(measured.moved).toBe(0);
    expect(measured.code).toBe(2);
  });
});

describe('a sweep of one token', () => {
  const renamed = (n, token) =>
    Array.from({ length: n }, (_, i) => ({
      deleted: [`const value${i} = row.${token};`],
      added: [`const value${i} = row.sourceId;`],
    }));

  it('discounts a substitution that recurs across the branch', () => {
    const measured = measureSurface(diff(fileDiff('backend/src/a.ts', renamed(8, 'categoryId'))));
    expect(measured.mechanical).toBe(16);
    expect(measured.code).toBe(0);
    // Sixteen lines at an eighth, rounded.
    expect(measured.surface).toBe(2);
    expect(measured.sweeps[0]).toEqual({ from: 'categoryId', to: 'sourceId', lines: 8 });
  });

  it('counts the same substitution in full when it happens only a few times', () => {
    const measured = measureSurface(diff(fileDiff('backend/src/a.ts', renamed(4, 'categoryId'))));
    expect(measured.mechanical).toBe(0);
    expect(measured.code).toBe(8);
    expect(measured.sweeps).toEqual([]);
  });

  it('does not discount a rewrite that changes more than one token', () => {
    const rewritten = Array.from({ length: 10 }, (_, i) => ({
      deleted: [`const value${i} = row.categoryId;`],
      added: [`const value${i} = await lookupSource(row.categoryId, client);`],
    }));
    const measured = measureSurface(diff(fileDiff('backend/src/a.ts', rewritten)));
    expect(measured.mechanical).toBe(0);
    expect(measured.code).toBe(20);
  });

  it('does not sweep prose, where a reworded phrase is a decision each time', () => {
    const reworded = Array.from({ length: 9 }, (_, i) => ({
      deleted: [`The category names the source number ${i}.`],
      added: [`The kind names the source number ${i}.`],
    }));
    const measured = measureSurface(diff(fileDiff('docs/tech/x.md', reworded)));
    expect(measured.mechanical).toBe(0);
    expect(measured.docs).toBe(18);
  });
});

describe('substitutionOf', () => {
  it('reads one token changed, however often it repeats on the line', () => {
    expect(substitutionOf('a(categoryId, categoryId)', 'a(sourceId, sourceId)')).toBe('categoryId\u0000sourceId');
  });

  it('refuses a line that also gained or lost a token', () => {
    expect(substitutionOf('f(a)', 'f(a, b)')).toBeNull();
  });

  it('refuses two independent changes on one line', () => {
    expect(substitutionOf('f(a, b)', 'g(a, c)')).toBeNull();
  });
});

describe('where a file sits', () => {
  it('names the kind that decides its weight', () => {
    expect(classifyFile('backend/src/db/membership.ts')).toBe('code');
    expect(classifyFile('db/migrations/055-kinds.sql')).toBe('migration');
    expect(classifyFile('db/init/01-schema.sql')).toBe('code');
    expect(classifyFile('docs/tech/review-surface.md')).toBe('docs');
    expect(classifyFile('README.md')).toBe('docs');
    expect(classifyFile('package-lock.json')).toBe('generated');
  });

  it('names the seam a split would follow', () => {
    expect(areaOf('backend/src/services/x.ts')).toBe('backend');
    expect(areaOf('frontend/src/components/X.tsx')).toBe('frontend');
    expect(areaOf('docs/decisions/0061-x.md')).toBe('docs/decisions');
    expect(areaOf('docs/tech/x.md')).toBe('docs');
    expect(areaOf('.claude/commands/pr-create.md')).toBe('tooling');
    expect(areaOf('scripts/review-surface.mjs')).toBe('tooling');
    expect(areaOf('package.json')).toBe('root');
  });

  it('reports an area in the surface’s own unit, so the seams sum to it', () => {
    // Four lines of prose cost the same review as two of code, and the seam
    // breakdown has to say so — otherwise the widest column is the cheapest one.
    const measured = measureSurface(
      diff(
        fileDiff('docs/tech/x.md', [{ added: ['One.', 'Two.', 'Three.', 'Four.'] }]),
        fileDiff('backend/src/a.ts', [{ added: ['const a = 1;', 'const b = 2;'] }]),
      ),
    );
    expect(measured.areas).toEqual([
      { area: 'docs', lines: 2 },
      { area: 'backend', lines: 2 },
    ]);
    expect(measured.surface).toBe(4);
  });

  it('leaves a swept token in the breakdown, at the weight it counts for', () => {
    const swept = Array.from({ length: 8 }, (_, i) => ({
      deleted: [`const value${i} = row.categoryId;`],
      added: [`const value${i} = row.sourceId;`],
    }));
    const measured = measureSurface(diff(fileDiff('backend/src/a.ts', swept)));
    // Sixteen mechanical lines at an eighth: the area says 2, and so does the
    // surface. Before, a sweep of 240 files showed no seam at all.
    expect(measured.areas).toEqual([{ area: 'backend', lines: 2 }]);
    expect(measured.surface).toBe(2);
  });

  it('hands out the rounding so the areas still add up to the surface', () => {
    // Half a line of prose here and half there is one line of review, not two.
    const measured = measureSurface(
      diff(
        fileDiff('docs/tech/x.md', [{ added: ['One sentence.'] }]),
        fileDiff('README.md', [{ added: ['Another sentence.'] }]),
      ),
    );
    expect(measured.surface).toBe(1);
    expect(measured.areas.reduce((sum, a) => sum + a.lines, 0)).toBe(1);
  });

  it('reports the areas largest first, so the widest seam is offered first', () => {
    const measured = measureSurface(
      diff(
        fileDiff('backend/src/a.ts', [{ added: ['const a = 1;', 'const b = 2;', 'const c = 3;'] }]),
        fileDiff('frontend/src/B.tsx', [{ added: ['const d = 4;'] }]),
      ),
    );
    expect(measured.areas).toEqual([
      { area: 'backend', lines: 3 },
      { area: 'frontend', lines: 1 },
    ]);
  });
});

describe('reading the diff itself', () => {
  it('does not read a deleted SQL comment as a file header', () => {
    // `-- Regions table` deleted reaches the diff as `--- Regions table`.
    // db/init/01-schema.sql alone holds 978 lines that start with `-- `.
    const measured = measureSurface(
      [
        'diff --git a/db/init/01-schema.sql b/db/init/01-schema.sql',
        '--- a/db/init/01-schema.sql',
        '+++ b/db/init/01-schema.sql',
        '@@ -1,3 +1,2 @@',
        '--- Regions table',
        '-const a = 1;',
        '+const a = 2;',
        '',
      ].join('\n'),
    );
    expect(measured.files).toBe(1);
    expect(measured.areas).toEqual([{ area: 'db', lines: 2 }]);
  });

  it('counts a renamed file once, whether or not it was also edited', () => {
    const header = [
      'diff --git a/backend/src/old.ts b/backend/src/new.ts',
      'similarity index 90%',
      'rename from backend/src/old.ts',
      'rename to backend/src/new.ts',
    ];
    const edited = measureSurface(
      [...header, '--- a/backend/src/old.ts', '+++ b/backend/src/new.ts', '@@ -1 +1 @@', '-const a = 1;', '+const a = 2;', ''].join('\n'),
    );
    expect(edited.files).toBe(1);
    expect(edited.codeFiles).toBe(1);

    // A pure rename carries no ---/+++ at all; its `rename to` names it.
    const pure = measureSurface(`${['diff --git a/backend/src/old.ts b/backend/src/new.ts', 'similarity index 100%', ...header.slice(2)].join('\n')}\n`);
    expect(pure.files).toBe(1);
    expect(pure.surface).toBe(0);
  });
});

describe('prose is not code', () => {
  it('counts a heading and a bold lead-in, which markdown writes with # and *', () => {
    const measured = measureSurface(
      diff(
        fileDiff('docs/tech/x.md', [
          { added: ['# A heading', '**A lead-in** with a sentence after it.', 'Plain prose.', '<!-- an HTML comment -->'] },
        ]),
      ),
    );
    expect(measured.docs).toBe(3);
  });

  it('still reads a comment opener as a comment in code', () => {
    const measured = measureSurface(
      diff(fileDiff('backend/src/a.ts', [{ added: ['# not code', 'const a = 1;'] }])),
    );
    expect(measured.code).toBe(1);
  });
});

describe('indentation', () => {
  it('reads a re-indentation inside one file as a change, not a move', () => {
    // In Python this is the behaviour; in review it is a line to read.
    const measured = measureSurface(
      diff(fileDiff('cv-python/app/x.py', [{ deleted: ['    return total'], added: ['        return total'] }])),
    );
    expect(measured.moved).toBe(0);
    expect(measured.code).toBe(2);
  });

  it('still cancels a block lifted into another file and re-indented there', () => {
    const measured = measureSurface(
      diff(
        fileDiff('backend/src/a.ts', [{ deleted: ['  const one = 1;', '  const two = 2;'] }]),
        fileDiff('backend/src/b.ts', [{ added: ['    const one = 1;', '    const two = 2;'] }]),
      ),
    );
    expect(measured.moved).toBe(4);
    expect(measured.surface).toBe(0);
    // The seam breakdown is in the same unit as the surface: an area that is
    // all moved lines is not work, and must not read as the widest seam.
    expect(measured.areas).toEqual([]);
  });
});

describe('a file created or deleted outright', () => {
  it('reads the name off whichever side is not /dev/null', () => {
    const created = [
      'diff --git a/backend/src/new.ts b/backend/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/backend/src/new.ts',
      '@@ -0,0 +1 @@',
      '+export const x = 1;',
    ].join('\n');
    const removed = [
      'diff --git a/docs/tech/old.md b/docs/tech/old.md',
      'deleted file mode 100644',
      '--- a/docs/tech/old.md',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-A sentence that was here.',
    ].join('\n');
    const measured = measureSurface(`${created}\n${removed}\n`);
    expect(measured.files).toBe(2);
    expect(measured.code).toBe(1);
    expect(measured.docs).toBe(1);
  });
});

describe('the command line', () => {
  it('defaults to the branch against main, at the repository budget', () => {
    // Against the constant, not the figure: the budget is written in one
    // place and a test that spells it out would be a second.
    expect(parseArgs([])).toEqual({ base: 'main', rev: 'HEAD', json: false, budget: SURFACE_BUDGET });
  });

  it('refuses a budget it cannot read, rather than passing every branch', () => {
    // NaN makes `surface > budget` false at any size, so the card would have
    // said "Within budget." for a 10 000-line branch.
    for (const argv of [
      ['--budget'],
      ['--budget', '8oo'],
      ['--budget', '-5'],
      ['--budget', '--json'],
      ['--budget', ''],
      ['--budget', '  '],
    ]) {
      expect(() => parseArgs(argv), argv.join(' ')).toThrow(/--budget/);
    }
    expect(parseArgs(['--budget', '250']).budget).toBe(250);
  });

  it('refuses a flag whose value is missing, rather than reading the next flag as it', () => {
    expect(() => parseArgs(['--base', '--json'])).toThrow(/--base needs a value/);
    expect(() => parseArgs(['--rev'])).toThrow(/--rev needs a value/);
    expect(() => parseArgs(['--base', ''])).toThrow(/--base needs a value/);
    expect(() => parseArgs(['--onto', 'main'])).toThrow(/Unknown argument/);
  });
});
