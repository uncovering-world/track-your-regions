import { describe, expect, it } from 'vitest';

import { LINE_POINTER, READ_EXTENSIONS, RECORDS, findLinePointers } from './lint-line-pointers.mjs';

/**
 * The pointer gate's own rule, held here as fixtures: what a line pointer is,
 * what merely looks like one, and which paths are records rather than living
 * prose. The gate's claim about the tree — that no living file holds one — is
 * the gate's to make on every run; this spec holds the ruler it measures with.
 */
describe('a line pointer', () => {
  it('is a source file name followed by a line, or a range', () => {
    const text = [
      'see `backend/src/services/wikivoyageExtract/parser.ts:83` for the shape',
      '-- martin/warm-tiles.sh:1 is where Semgrep stops',
      '# frontend/src/components/WorldViewEditor.tsx:544-560 drew this',
      'db/init/01-schema.sql:2114 and scripts/setup-integrations.sh:33, cv/match.py:390, ci.yml:11, config.yaml:7, gates.mjs:9',
      // A pointer into a Markdown page expires exactly as one into a source file does.
      'docs/tech/experiences.md:95 and SECURITY.md:214',
    ].join('\n');
    expect(findLinePointers(text)).toEqual([
      { line: 1, match: 'backend/src/services/wikivoyageExtract/parser.ts:83' },
      { line: 2, match: 'martin/warm-tiles.sh:1' },
      { line: 3, match: 'frontend/src/components/WorldViewEditor.tsx:544-560' },
      { line: 4, match: 'db/init/01-schema.sql:2114' },
      { line: 4, match: 'scripts/setup-integrations.sh:33' },
      { line: 4, match: 'cv/match.py:390' },
      { line: 4, match: 'ci.yml:11' },
      { line: 4, match: 'config.yaml:7' },
      { line: 4, match: 'gates.mjs:9' },
      { line: 5, match: 'docs/tech/experiences.md:95' },
      { line: 5, match: 'SECURITY.md:214' },
    ]);
  });

  it('is not a symbol, a section, a URL, a time or a port', () => {
    const text = [
      "`RegionList`'s `useVirtualizer`, `SECURITY.md` § Known Gaps, `experienceLifecycle.ts`",
      'https://github.com/uncovering-world/track-your-regions/blob/main/backend/src/index.ts#L12',
      // A URL naming a file with a line: the match must not start after the scheme's colon.
      'see https://example.test/src/foo.ts:42 and http://example.test/docs/page.md:7-9',
      'at 10:30 on 2026-09-22, http://localhost:3001/health, postgres:5432',
      'vitest.config.ts: the include list; foo.ts:bar; TS2345 at line 12',
    ].join('\n');
    expect(findLinePointers(text)).toEqual([]);
  });

  it('is matched by a global pattern, so one line can carry several', () => {
    expect(LINE_POINTER.flags).toContain('g');
  });
});

describe('what the gate reads', () => {
  it('is Markdown and every file type that carries a comment', () => {
    for (const extension of ['md', 'ts', 'tsx', 'mjs', 'sql', 'sh', 'py', 'yml', 'yaml']) {
      expect(READ_EXTENSIONS, extension).toContain(extension);
    }
  });

  it('exempts each point-in-time record with a reason of its own', () => {
    // The exemption is the guide's, not this file's: an ADR, an audit report and
    // a migration describe the code as of a date, so a pointer there is evidence.
    const prefixes = RECORDS.map(([prefix]) => prefix);
    expect(prefixes).toContain('docs/decisions/');
    expect(prefixes).toContain('docs/security/audit-');
    expect(prefixes).toContain('db/migrations/');
    for (const [prefix, reason] of RECORDS) {
      expect(reason, prefix).toMatch(/\S+ \S+/);
    }
    // Living prose is never on the list: a doc under docs/tech is read as
    // current, and only the plans beneath it — gitignored working documents —
    // are records.
    expect(prefixes).toContain('docs/tech/planning/');
    expect(prefixes.filter((prefix) => prefix.startsWith('docs/tech/'))).toEqual(['docs/tech/planning/']);
    expect(prefixes).not.toContain('CLAUDE.md');
  });
});
