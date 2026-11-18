import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DROP_STEP, LEDGER_PATH, NOT_READ, READ, entryPattern, judge, ledgerFaults, mentionsIn,
} from './lint-retired-model.mjs';

/**
 * The retired-model gate's own rule, held here as fixtures: what a mention of
 * an entry is, what is not one, how a mention is judged by its entry's state,
 * and what a well-formed ledger holds. Whether the tree names a retired entry
 * is the gate's to answer on every run; this spec holds the ruler.
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ledger = JSON.parse(readFileSync(root + '/' + LEDGER_PATH, 'utf8'));

const entry = (overrides) => ({ id: 'x', what: 'x', slice: 'B2', issue: 2584, state: 'retired', ...overrides });
const compiled = (entries) => entries.map((e) => ({ entry: e, pattern: entryPattern(e) }));
const mentionsOf = (path, text, entries) => mentionsIn(text, compiled(entries)).map((m) => ({ path, ...m }));

describe('a mention of an entry', () => {
  it('is a name as a whole identifier, never a part of a longer one', () => {
    const place = entry({ names: ['place_stands', 'admitted_for', 'experiences.existence'] });
    const text = [
      'DROP FUNCTION IF EXISTS place_stands(INTEGER);',
      'CREATE TRIGGER trg_new_place_stands',
      'SELECT admitted_for_item, admitted_for_label FROM source_records',
      "UPDATE experiences SET admitted_for = '{}'",
      'COMMENT ON COLUMN experiences.existence IS',
    ].join('\n');
    expect(mentionsIn(text, compiled([place])).map((m) => m.line)).toEqual([1, 4, 5]);
  });

  it("is found by the ledger's patterns where the model retires it, and not in a word that merely shares it", () => {
    const entries = compiled(ledger.entries);
    const hits = (text) => mentionsIn(text, entries).map((m) => m.entry.id);
    // A point's existence, as a column, a value and a type.
    expect(hits("WHERE el.existence <> 'lost'")).toContain('point-existence');
    expect(hits("{ membership: 'present', existence: 'extant', flagged: true }")).toContain('point-existence');
    expect(hits("import type { Existence } from '@tyr/shared/lifecycle';")).toContain('point-existence');
    // A place's existence, retired by B2.
    expect(hits('ALTER TABLE experiences ADD COLUMN existence; SELECT experiences.existence')).toContain('place-existence');
    expect(hits("-- recount when a place's existence changes")).toContain('place-existence');
    // The same word in what the model keeps: a page that exists on Wikivoyage,
    // a handler's check that a row exists, Wikidata's end of existence, and
    // the gone places an issue once asked a virtual kind for.
    for (const text of [
      'if (options?.pageExistence && options.pageExistence.size > 0) {',
      'async function backfillPageExistence(',
      'Wikivoyage page existence is read once per tree',
      '// The existence check ran on the pool, on another connection',
      '/** A state of use that agrees with an end of existence: closed, for good or since. */',
      "Old Bridge in Mostar states no end of existence, and reads 1566",
      "#2009's body asked for a virtual kind of gone places",
      'const known = graph.facts(qid);',
    ]) {
      expect(hits(text), text).toEqual([]);
    }
  });
});

describe('a judgement', () => {
  const retired = entry({ id: 'place-existence', names: ['experiences.existence'] });
  const pending = entry({ id: 'point-tables', names: ['experience_locations'], slice: 'B5', issue: 2124, state: 'pending' });

  it('fails a retired entry named in living code', () => {
    const mentions = mentionsOf('backend/src/a.ts', "pool.query('SELECT experiences.existence FROM experiences')", [retired]);
    const { failures, debt } = judge(mentions, { entries: [retired], allow: [] });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ path: 'backend/src/a.ts', line: 1, entry: { id: 'place-existence' } });
    expect(debt.size).toBe(0);
  });

  it('counts a pending entry as its slice’s debt, and fails nothing for it', () => {
    const text = 'SELECT 1 FROM experience_locations\nJOIN experience_locations el ON true';
    const mentions = [...mentionsOf('backend/src/a.ts', text, [pending]), ...mentionsOf('docs/tech/b.md', 'experience_locations', [pending])];
    const { failures, debt } = judge(mentions, { entries: [pending], allow: [] });
    expect(failures).toEqual([]);
    expect(debt.get('point-tables').mentions).toBe(3);
    expect(debt.get('point-tables').files.size).toBe(2);
  });

  it('lets an allow line cover the line it names, and fails one that covers nothing', () => {
    const mentions = mentionsOf('frontend/src/log.ts', '// an old entry carries experiences.existence', [retired]);
    const allow = { entry: 'place-existence', path: 'frontend/src/log.ts', text: 'an old entry carries', why: 'an old log entry' };
    const stale = { entry: 'place-existence', path: 'frontend/src/gone.ts', why: 'nothing here any more' };
    const result = judge(mentions, { entries: [retired], allow: [allow, stale] });
    expect(result.failures).toEqual([]);
    expect(result.allowed).toHaveLength(1);
    expect(result.stale).toEqual([expect.objectContaining({ path: 'frontend/src/gone.ts' })]);
  });

  it("counts a schema file's drop of a retired name as owed to the switch, and the same line elsewhere as a failure", () => {
    const line = 'DROP FUNCTION IF EXISTS place_stands(INTEGER);';
    const stands = entry({ id: 'standing', names: ['place_stands'] });
    expect(DROP_STEP.test(line)).toBe(true);
    const inSchema = judge(mentionsOf('db/init/01-schema.sql', line, [stands]), { entries: [stands] });
    expect(inSchema.failures).toEqual([]);
    expect(inSchema.dropSteps).toHaveLength(1);
    const inCode = judge(mentionsOf('backend/src/a.ts', line, [stands]), { entries: [stands] });
    expect(inCode.failures).toHaveLength(1);
  });
});

describe('the ledger', () => {
  it('is well formed', () => {
    expect(ledgerFaults(ledger)).toEqual([]);
  });

  it('refuses an entry with no state, no slice or a pattern that does not compile, and an allow line with no reason', () => {
    const faults = ledgerFaults({
      entries: [
        { id: 'a', what: 'a', names: ['a'], slice: 'B1', issue: 1, state: 'gone' },
        { id: 'b', what: 'b', pattern: '(', issue: null, state: 'pending' },
      ],
      allow: [{ entry: 'c', path: 'x.ts' }],
    });
    expect(faults).toEqual(expect.arrayContaining([
      expect.stringMatching(/entry a: state is gone/),
      expect.stringMatching(/entry b: no slice/),
      expect.stringMatching(/entry b: Invalid regular expression/),
      expect.stringMatching(/allow x\.ts \(c\): names no entry/),
      expect.stringMatching(/allow x\.ts \(c\): gives no reason/),
    ]));
  });

  it('holds as retired what has merged: the dates in slots, standing at write time, and a place’s existence and state verdict', () => {
    const states = Object.fromEntries(ledger.entries.map((e) => [e.id, e.state]));
    for (const id of ['dates-in-slots', 'standing-from-open-period', 'place-existence', 'place-state-verdict']) {
      expect(states[id], id).toBe('retired');
    }
    for (const id of ['point-tables', 'point-existence', 'membership-facts', 'visit-tables']) {
      expect(states[id], id).toBe('pending');
    }
  });

  it('gives every allow line a reason of its own', () => {
    for (const allow of ledger.allow) expect(allow.why, allow.path).toMatch(/\S+ \S+ \S+/);
  });
});

describe('what the gate reads', () => {
  it('is the living text, never a point-in-time record', () => {
    for (const record of ['docs/decisions/', 'docs/research/', 'db/migrations/']) {
      expect(READ.some((prefix) => prefix.startsWith(record) || record.startsWith(prefix)), record).toBe(false);
    }
    for (const living of ['db/init/', 'backend/', 'frontend/', 'packages/', 'docs/tech/', 'docs/vision/', 'CLAUDE.md', '.claude/skills/']) {
      expect(READ, living).toContain(living);
    }
    expect(NOT_READ.map(([path]) => path)).toContain(LEDGER_PATH);
  });
});
