import { describe, expect, it } from 'vitest';
import { namedShrinks, SHRINK_FLOOR, shrunkFiles } from './check-shrunk-files.mjs';

/** The emptied-file gate (#537): what it lets through and what it stops. */
describe('a tracked file that emptied or shrank', () => {
  it('stops a file emptied whatever its size, and one cut below a quarter once it is large enough to judge', () => {
    const sizes = [
      { path: 'docs/vision/vision.md', before: 177189, after: 0 },
      { path: 'backend/src/index.ts', before: 8292, after: 200 },
      { path: 'tiny.txt', before: 40, after: 0 },
      { path: 'small.ts', before: SHRINK_FLOOR - 1, after: 10 },
      { path: 'edited.ts', before: 8000, after: 2500 },
    ];
    expect(shrunkFiles(sizes).map(({ path, emptied }) => [path, emptied])).toEqual([
      ['docs/vision/vision.md', true],
      ['backend/src/index.ts', false],
      ['tiny.txt', true],
    ]);
  });

  it('never stops a file that was already empty at the base', () => {
    expect(shrunkFiles([{ path: 'cv-python/app/__init__.py', before: 0, after: 0 }])).toEqual([]);
  });

  it('lets through a file a commit body names, with a reason', () => {
    const named = namedShrinks([
      'back: Declare the last admin routes.',
      '',
      'Shrinks: backend/src/routes/adminRoutes.ts -- the routes are declarations now',
      'Shrinks: docs/a.md --',
      'Shrinks: docs/b.md no reason',
    ].join('\n'));
    expect([...named]).toEqual(['backend/src/routes/adminRoutes.ts']);
    expect(shrunkFiles([{ path: 'backend/src/routes/adminRoutes.ts', before: 11407, after: 273 }], named)).toEqual([]);
  });
});
