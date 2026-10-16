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

import type { CoverageReport, LiveKindGaps } from '../catalogueCoverage/report.js';
import { AssertionUnavailable } from './assertion.js';
import { coverageAssertions, coverageFindings, NOT_LOADED } from './coverageAssertions.js';

const [check] = coverageAssertions;

function liveKind(over: Partial<LiveKindGaps>): LiveKindGaps {
  return {
    slug: 'archaeology', name: 'Archaeology', line: 22, expected: 0, offered: 0,
    wellKnownMissing: [], belowLineMissing: 0, ...over,
  };
}

function report(liveKinds: LiveKindGaps[], expectations = 1): CoverageReport {
  return {
    regions: [
      { slug: 'cusco-region', name: 'Cusco region', country: 'Peru', surveyed: '2026-10-02', total: 1, counts: {} as never },
      { slug: 'mexico-city', name: 'Mexico City', country: 'Mexico', surveyed: '2026-10-02', total: 1, counts: {} as never },
    ],
    proposedKinds: [],
    liveKinds,
    expectations: Array.from({ length: expectations }, () => ({}) as never),
  };
}

const archaeology = liveKind({
  expected: 213, offered: 81, belowLineMissing: 116,
  wellKnownMissing: [
    { regionSlug: 'cusco-region', name: 'Ollantaytambo', sitelinks: 40, sourceCount: 6, verdict: 'missing_live' },
    { regionSlug: 'cusco-region', name: 'Pisac', sitelinks: 28, sourceCount: 6, verdict: 'held' },
  ],
});

const artMuseums = liveKind({
  slug: 'art-museums', name: 'Art Museums', line: null, expected: 135, offered: 8,
  wellKnownMissing: [
    { regionSlug: 'mexico-city', name: 'Museo Frida Kahlo', sitelinks: 30, sourceCount: 7, verdict: 'missing_live' },
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
      wellKnownMissing: [{ regionSlug: 'rome', name: 'Sistine Chapel', sitelinks: 90, sourceCount: 7, verdict: 'offered' }],
    })]));

    // A region the report does not name is said by its slug rather than dropped.
    expect(check.describe(rows[0])).toBe('Sistine Chapel (rome), named by 7 sources, 90 sitelinks: '
      + 'Art Museums does not offer it, and a reader finds it under another kind.');
  });

  it('leaves the sitelinks out where Wikidata gave none', () => {
    const { rows } = coverageFindings(report([liveKind({
      expected: 1,
      wellKnownMissing: [{ regionSlug: 'cusco-region', name: 'Tipón', sitelinks: null, sourceCount: 3, verdict: 'same_spot' }],
    })]));

    expect(check.describe(rows[0])).toBe('Tipón (Cusco region), named by 3 sources: Archaeology does not offer it, '
      + 'and something else stands at its spot, which may be the same place under another Wikidata item.');
  });

  it('says a name that carries control characters on one line', () => {
    const { rows } = coverageFindings(report([liveKind({
      expected: 1,
      wellKnownMissing: [{ regionSlug: 'cusco-region', name: 'Moray\nInjected', sitelinks: 18, sourceCount: 4, verdict: 'missing_live' }],
    })]));

    expect(check.describe(rows[0])).not.toMatch(/\n/);
  });
});

describe('the lines beside the rows', () => {
  it('says how much of what is expected each live kind offers, and what sits under its line', () => {
    const { context } = coverageFindings(report([archaeology, artMuseums, worldHeritage, liveKind({ slug: 'public-art', name: 'Public Art & Monuments' })]));

    expect(context).toEqual([
      'Archaeology offers 81 of the 213 expected of it; 2 it lacks are at or over its line of 22 sitelinks '
        + 'and listed, and 116 under the line are the regional tier\'s to hold.',
      'Art Museums offers 8 of the 135 expected of it; it draws no sitelinks line, so the one it lacks is listed.',
      'World Heritage Sites offers 54 of the 54 expected of it.',
      'Public Art & Monuments: no survey expects anything of it yet.',
    ]);
  });

  it('says a kind lacks nothing under its line when all it lacks is well known', () => {
    const { context } = coverageFindings(report([liveKind({
      expected: 10, offered: 9, belowLineMissing: 0,
      wellKnownMissing: [{ regionSlug: 'cusco-region', name: 'Ollantaytambo', sitelinks: 40, sourceCount: 6, verdict: 'missing_live' }],
    })]));

    expect(context).toEqual([
      'Archaeology offers 9 of the 10 expected of it; 1 it lacks is at or over its line of 22 sitelinks '
        + 'and listed, and nothing it lacks sits under the line.',
    ]);
  });

  it('says a kind lacks nothing well known when all it lacks sits under its line', () => {
    const { context } = coverageFindings(report([liveKind({
      slug: 'public-art', name: 'Public Art & Monuments', expected: 93, offered: 92, belowLineMissing: 1,
    })]));

    expect(context).toEqual([
      'Public Art & Monuments offers 92 of the 93 expected of it; none it lacks is at or over its line '
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
