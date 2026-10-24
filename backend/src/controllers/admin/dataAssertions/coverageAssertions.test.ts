/**
 * What the panel says about what the catalogue lacks (#1162).
 *
 * The decision of what a kind lacks is the coverage report's and is tested
 * there; this pins how its findings become rows: one per kind and entry, the
 * most named first, every live kind's proportion said beside them, and empty
 * tables never read as a clean catalogue.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import type { Cause } from '../../../services/catalogueCoverage/files.js';
import type { CoverageReport, LiveKindGaps, RegionUnnamed, UnnamedPlace } from '../catalogueCoverage/report.js';
import { AssertionUnavailable } from './assertion.js';
import { coverageAssertions, coverageFindings, NOT_LOADED, unnamedFindings } from './coverageAssertions.js';

const [check] = coverageAssertions;

type Missing = LiveKindGaps['wellKnownMissing'][number];

function liveKind(over: Partial<LiveKindGaps>): LiveKindGaps {
  return {
    slug: 'archaeology', name: 'Archaeology', line: 22, expected: 0, offered: 0,
    wellKnownMissing: [], judgedByCause: [], belowLineMissing: 0, calibration: null, ...over,
  };
}

function missing(regionSlug: string, name: string, over: Partial<Missing>): Missing {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return { regionSlug, slug, name, sitelinks: null, sourceCount: 2, verdict: 'missing_live', judgement: null, ...over };
}

function report(liveKinds: LiveKindGaps[], expectations = 1, stale: CoverageReport['staleJudgements'] = []): CoverageReport {
  return {
    regions: [
      { slug: 'cusco-region', name: 'Cusco region', country: 'Peru', surveyed: '2026-10-02', total: 1, counts: {} as never },
      { slug: 'mexico-city', name: 'Mexico City', country: 'Mexico', surveyed: '2026-10-02', total: 1, counts: {} as never },
    ],
    proposedKinds: [],
    liveKinds,
    expectations: Array.from({ length: expectations }, () => ({}) as never),
    staleJudgements: stale,
    unnamed: [],
    staleRowJudgements: [],
  };
}

const archaeology = liveKind({
  expected: 213, offered: 81, belowLineMissing: 116,
  wellKnownMissing: [
    missing('cusco-region', 'Ollantaytambo', { sitelinks: 40, sourceCount: 6 }),
    missing('cusco-region', 'Pisac', { sitelinks: 28, sourceCount: 6, verdict: 'held' }),
  ],
});

const artMuseums = liveKind({
  slug: 'art-museums', name: 'Art Museums', line: null, expected: 135, offered: 8,
  wellKnownMissing: [
    missing('mexico-city', 'Museo Frida Kahlo', { sitelinks: 30, sourceCount: 7 }),
  ],
});

const worldHeritage = liveKind({ slug: 'world-heritage', name: 'World Heritage Sites', line: null, expected: 54, offered: 54 });

describe('the findings', () => {
  it('lists one row per kind and entry, the most named first, under the region\'s own name', () => {
    const { rows } = coverageFindings(report([archaeology, artMuseums]));

    expect(rows.map(row => check.describe(row))).toEqual([
      'Museo Frida Kahlo (Mexico City), named by 7 sources, 30 sitelinks: Art Museums does not offer it, '
        + 'and the catalogue does not hold it.',
      'Ollantaytambo (Cusco region), named by 6 sources, 40 sitelinks: Archaeology does not offer it, '
        + 'and the catalogue does not hold it.',
      'Pisac (Cusco region), named by 6 sources, 28 sitelinks: Archaeology does not offer it, '
        + 'and the catalogue holds it and no reader sees it: it waits for a curator, was refused, or no longer stands.',
    ]);
  });

  it('says where a reader does find an entry another kind offers', () => {
    const { rows } = coverageFindings(report([liveKind({
      slug: 'art-museums', name: 'Art Museums', line: null, expected: 1,
      wellKnownMissing: [missing('rome', 'Sistine Chapel', { sitelinks: 90, sourceCount: 7, verdict: 'offered' })],
    })]));

    // A region the report does not name is said by its slug rather than dropped.
    expect(check.describe(rows[0])).toBe('Sistine Chapel (rome), named by 7 sources, 90 sitelinks: '
      + 'Art Museums does not offer it, and a reader finds it under another kind.');
  });

  it('leaves the sitelinks out where Wikidata gave none', () => {
    const { rows } = coverageFindings(report([liveKind({
      expected: 1,
      wellKnownMissing: [missing('cusco-region', 'Tipón', { sourceCount: 3, verdict: 'same_spot' })],
    })]));

    expect(check.describe(rows[0])).toBe('Tipón (Cusco region), named by 3 sources: Archaeology does not offer it, '
      + 'and something else stands at its spot, which may be the same place under another Wikidata item.');
  });

  it('says a name that carries control characters on one line', () => {
    const { rows } = coverageFindings(report([liveKind({
      expected: 1,
      wellKnownMissing: [missing('cusco-region', 'Moray\nInjected', { sitelinks: 18, sourceCount: 4 })],
    })]));

    expect(check.describe(rows[0])).not.toMatch(/\n/);
  });
});

describe('what a person has judged', () => {
  const judgedMuseums = liveKind({
    slug: 'art-museums', name: 'Art Museums', line: null, expected: 135, offered: 8,
    wellKnownMissing: [
      missing('mexico-city', 'Museo Frida Kahlo', { sitelinks: 30, sourceCount: 7, judgement: { cause: 'door-missing', issue: 628, judged: '2026-10-16', note: 'Waits for the regional tier.' } }),
      missing('mexico-city', 'Museo Soumaya', { sitelinks: 28, sourceCount: 5, judgement: { cause: 'rule-defect', issue: 1620, judged: '2026-10-16', note: 'Typed a museum network.' } }),
      missing('mexico-city', 'Museo Jumex', { sitelinks: 4, sourceCount: 5 }),
    ],
    judgedByCause: [{ cause: 'door-missing', count: 1, issues: [628] }, { cause: 'rule-defect', count: 1, issues: [1620] }],
  });

  it('lists only the rows nobody has judged, and counts the judged by cause beside them', () => {
    const { rows, context } = coverageFindings(report([judgedMuseums]));

    expect(rows.map(row => check.describe(row))).toEqual([
      'Museo Jumex (Mexico City), named by 5 sources, 4 sitelinks: Art Museums does not offer it, and the catalogue does not hold it.',
    ]);
    expect(context).toEqual([
      'Art Museums offers 8 of the 135 expected of it; it draws no sitelinks line, so all 3 it lacks are listed. '
        + '2 of them are judged: 1 door-missing (#628); 1 rule-defect (#1620); 1 waits for a person.',
    ]);
  });

  it('lists a judgement whose gap has closed as a line to remove, after the findings', () => {
    const { rows } = coverageFindings(report([judgedMuseums], 1, [
      { regionSlug: 'cusco-region', slug: 'moray', name: 'Moray', kindSlug: 'archaeology', kindName: 'Archaeology', cause: 'rule-defect', issue: 1160, judged: '2026-10-16', note: 'Never asked.' },
      { regionSlug: 'cusco-region', slug: 'mask', name: 'Mask', kindSlug: 'notable-works', kindName: 'Notable works', cause: 'not-a-must', issue: null, judged: '2026-10-16', note: 'A copy.' },
    ]));

    expect(rows.map(row => check.describe(row))).toEqual([
      'Museo Jumex (Mexico City), named by 5 sources, 4 sitelinks: Art Museums does not offer it, and the catalogue does not hold it.',
      'Moray (Cusco region): judged rule-defect (#1160) on 2026-10-16, and Archaeology offers it now: '
        + 'the line comes out of judgements.jsonl.',
      'Mask (Cusco region): judged not-a-must on 2026-10-16, and Notable works offers it now: '
        + 'the line comes out of judgements.jsonl.',
    ]);
  });

  it('says a kind whose every gap is judged has none waiting', () => {
    const allJudged = liveKind({
      expected: 2, offered: 1,
      wellKnownMissing: [missing('cusco-region', 'Ollantaytambo', { sitelinks: 40, sourceCount: 6, judgement: { cause: 'rule-defect', issue: 1160, judged: '2026-10-16', note: 'A town item.' } })],
      judgedByCause: [{ cause: 'rule-defect', count: 1, issues: [1160] }],
    });
    const { rows, context } = coverageFindings(report([allJudged]));

    expect(rows).toEqual([]);
    expect(context[0]).toMatch(/ 1 of them is judged: 1 rule-defect \(#1160\); none waits for a person\.$/);
  });
});

describe('the lines beside the rows', () => {
  it('says how much of what is expected each live kind offers, and what sits under its line', () => {
    const { context } = coverageFindings(report([archaeology, artMuseums, worldHeritage, liveKind({ slug: 'public-art', name: 'Public art' })]));

    expect(context).toEqual([
      'Archaeology offers 81 of the 213 expected of it; 2 it lacks are at or over its line of 22 sitelinks '
        + 'and listed, and 116 under the line are the regional tier\'s to hold.',
      'Art Museums offers 8 of the 135 expected of it; it draws no sitelinks line, so the one it lacks is listed.',
      'World Heritage Sites offers 54 of the 54 expected of it.',
      'Public art: no survey expects anything of it yet.',
    ]);
  });

  it('says a kind lacks nothing under its line when all it lacks is well known', () => {
    const { context } = coverageFindings(report([liveKind({
      expected: 10, offered: 9, belowLineMissing: 0,
      wellKnownMissing: [missing('cusco-region', 'Ollantaytambo', { sitelinks: 40, sourceCount: 6 })],
    })]));

    expect(context).toEqual([
      'Archaeology offers 9 of the 10 expected of it; 1 it lacks is at or over its line of 22 sitelinks '
        + 'and listed, and nothing it lacks sits under the line.',
    ]);
  });

  it('says a kind lacks nothing well known when all it lacks sits under its line', () => {
    const { context } = coverageFindings(report([liveKind({
      slug: 'public-art', name: 'Public art', expected: 93, offered: 92, belowLineMissing: 1,
    })]));

    expect(context).toEqual([
      'Public art offers 92 of the 93 expected of it; none it lacks is at or over its line '
        + 'of 22 sitelinks, and 1 under the line is the regional tier\'s to hold.',
    ]);
  });
});

describe('tables nobody loaded', () => {
  it('reports nothing as missing and says the lists have not been loaded', () => {
    expect(() => coverageFindings(report([archaeology], 0))).toThrow(AssertionUnavailable);
    expect(() => coverageFindings(report([archaeology], 0))).toThrow(NOT_LOADED);
  });
});

describe('the check', () => {
  it('is an invariant about coverage, so its count can be accepted and a loss reads as growth', () => {
    expect(check.kind).toBe('invariant');
    expect(check.area).toBe('coverage');
  });
});

describe('what a region offers that no guide names', () => {
  const [, junk] = coverageAssertions;
  const place = (name: string, over: Partial<UnnamedPlace> = {}): UnnamedPlace => ({
    experienceId: name.length, name, wikidataId: `Q${name.length}`, kinds: ['Archaeology'], sitelinks: 20, km: 1, judgement: null, ...over,
  });
  const judgedRow = (cause: Cause, issue: number | null = null) => ({ cause, issue, judged: '2026-10-17', note: 'Read on the ground.' });
  const rome: RegionUnnamed = {
    regionSlug: 'rome', regionName: 'Rome', total: 4,
    unjudged: [place('Temple of Portunus', { sitelinks: 30 })], unjudgeable: [],
    judgedByCause: [{ cause: 'worth-a-visit', count: 1, issues: [] }, { cause: 'not-a-must', count: 1, issues: [] }, { cause: 'rule-defect', count: 1, issues: [1700] }],
    standing: [
      place('Umbilicus urbis Romae', { sitelinks: 22, judgement: judgedRow('not-a-must') }),
      place('Via Salaria', { sitelinks: 35, kinds: ['Archaeology', 'Public art'], judgement: judgedRow('rule-defect', 1700) }),
    ],
  };
  const withUnnamed = (unnamed: RegionUnnamed[], stale: CoverageReport['staleRowJudgements'] = []): CoverageReport =>
    ({ ...report([archaeology]), unnamed, staleRowJudgements: stale });

  it('lists what a person judged not worth a visit while a kind still offers it, and the line beside says how the region stands', () => {
    const { rows, context } = unnamedFindings(withUnnamed([rome]));

    expect(rows.map(row => junk.describe(row))).toEqual([
      'Umbilicus urbis Romae (Rome), Archaeology, 22 sitelinks: judged not-a-must on 2026-10-17, and the kind still offers it: its rule or a curator answers it.',
      'Via Salaria (Rome), Archaeology, Public art, 35 sitelinks: judged rule-defect (#1700) on 2026-10-17, and the kind still offers it: its rule or a curator answers it.',
    ]);
    expect(context).toEqual([
      'Rome offers 4 within its reach that no guide names; 3 are judged: 1 worth-a-visit; 1 not-a-must; 1 rule-defect (#1700); 1 waits for a person.',
    ]);
  });

  it('says a region with nothing unjudged and nothing unnamed each in a line, and lists a stale row judgement after the findings', () => {
    const berlin: RegionUnnamed = {
      regionSlug: 'berlin', regionName: 'Berlin', total: 3,
      unjudged: [place('Neptunbrunnen'), place('Berlin Mosque', { sitelinks: null })],
      unjudgeable: [place('A property only UNESCO names', { wikidataId: null, kinds: ['World Heritage Sites'], sitelinks: null })],
      judgedByCause: [], standing: [],
    };
    const dakar: RegionUnnamed = { regionSlug: 'dakar', regionName: 'Dakar', total: 0, unjudged: [], unjudgeable: [], judgedByCause: [], standing: [] };
    const { rows, context } = unnamedFindings(withUnnamed([berlin, dakar], [
      { regionSlug: 'cusco-region', wikidataId: 'Q96000099', cause: 'not-a-must', issue: null, judged: '2026-10-16', note: 'Gone.' },
    ]));

    expect(rows.map(row => junk.describe(row))).toEqual([
      'Row Q96000099 (Cusco region): judged not-a-must on 2026-10-16, and no offered place within reach carries it now: the line comes out of judgements.jsonl.',
    ]);
    expect(context).toEqual([
      'Berlin offers 3 within its reach that no guide names; 2 wait for a person; 1 has no Wikidata id to judge by.',
      'Dakar: everything it offers within its reach is named by a guide.',
    ]);
  });

  it('leaves the sitelinks out where the source recorded none, and reports nothing with the tables unloaded', () => {
    const { rows } = unnamedFindings(withUnnamed([{ ...rome, standing: [place('A property', { sitelinks: null, kinds: ['World Heritage Sites'], judgement: judgedRow('not-a-must') })] }]));
    expect(junk.describe(rows[0])).toBe('A property (Rome), World Heritage Sites: judged not-a-must on 2026-10-17, and the kind still offers it: its rule or a curator answers it.');
    expect(() => unnamedFindings({ ...withUnnamed([rome]), expectations: [] })).toThrow(NOT_LOADED);
  });

  it('is an invariant about coverage with an id of its own', () => {
    expect(junk).toMatchObject({ id: 'offered-and-named-by-no-guide', kind: 'invariant', area: 'coverage' });
  });
});
