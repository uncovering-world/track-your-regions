import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseWikidataBindings, parseDisputeClaimBindings, fetchDisputeClaims } from './wikidataSource.js';
import * as wikidataUtils from '../sync/wikidataUtils.js';
import type { SparqlBinding } from '../sync/wikidataUtils.js';

vi.mock('../sync/wikidataUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sync/wikidataUtils.js')>();
  return { ...actual, sparqlQuery: vi.fn() };
});

const E = 'http://www.wikidata.org/entity/';

function binding(over: Record<string, string | undefined>): SparqlBinding {
  const b: SparqlBinding = {};
  for (const [k, v] of Object.entries(over)) if (v !== undefined) b[k] = { value: v };
  return b;
}

describe('parseWikidataBindings', () => {
  it('parses a UN member with full codes', () => {
    const rows = parseWikidataBindings([binding({
      item: `${E}Q142`, itemLabel: 'France', iso2: 'FR', iso3: 'FRA',
      isoNumeric: '250', unMember: 'true',
    })]);
    expect(rows).toEqual([{
      qid: 'Q142', label: 'France', iso2: 'FR', iso3: 'FRA', isoNumeric: 250,
      isUnMember: true, hasLimitedRecognition: false, sovereignQid: null, claimedByQids: [],
    }]);
  });

  it('aggregates multi-row claimedBy into one entry', () => {
    const rows = parseWikidataBindings([
      binding({ item: `${E}Q1246`, itemLabel: 'Kosovo', iso2: 'XK', limited: 'true', claimedBy: `${E}Q403` }),
      binding({ item: `${E}Q1246`, itemLabel: 'Kosovo', iso2: 'XK', limited: 'true', claimedBy: `${E}Q403` }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].claimedByQids).toEqual(['Q403']);
    expect(rows[0].hasLimitedRecognition).toBe(true);
    expect(rows[0].isUnMember).toBe(false);
  });

  it('keeps sovereign link only when it differs from the entity itself', () => {
    const rows = parseWikidataBindings([
      binding({ item: `${E}Q223`, itemLabel: 'Greenland', iso2: 'GL', sovereign: `${E}Q35` }),
      binding({ item: `${E}Q35`, itemLabel: 'Denmark', iso2: 'DK', unMember: 'true', sovereign: `${E}Q35` }),
    ]);
    expect(rows.find((r) => r.qid === 'Q223')?.sovereignQid).toBe('Q35');
    expect(rows.find((r) => r.qid === 'Q35')?.sovereignQid).toBeNull();
  });

  it('accumulates two distinct claimants', () => {
    const rows = parseWikidataBindings([
      binding({ item: `${E}Q1246`, itemLabel: 'Kosovo', iso2: 'XK', limited: 'true', claimedBy: `${E}Q403` }),
      binding({ item: `${E}Q1246`, itemLabel: 'Kosovo', iso2: 'XK', limited: 'true', claimedBy: `${E}Q212` }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].claimedByQids).toEqual(['Q403', 'Q212']);
  });

  it('upgrades flags from later rows', () => {
    const rows = parseWikidataBindings([
      binding({ item: `${E}Q142`, itemLabel: 'France', iso2: 'FR' }),
      binding({ item: `${E}Q142`, itemLabel: 'France', iso2: 'FR', unMember: 'true' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].isUnMember).toBe(true);
  });

  it('backfills iso3 and sovereign from later rows', () => {
    const rows = parseWikidataBindings([
      binding({ item: `${E}Q223`, itemLabel: 'Greenland', iso2: 'GL', sovereign: `${E}Q223` }),
      binding({ item: `${E}Q223`, itemLabel: 'Greenland', iso3: 'GRL', sovereign: `${E}Q35` }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].iso3).toBe('GRL');
    expect(rows[0].sovereignQid).toBe('Q35');
  });
});

describe('parseDisputeClaimBindings', () => {
  it('maps item qid -> deduped claimant qids', () => {
    const bindings: SparqlBinding[] = [
      binding({ item: `${E}Q7835`, claimedBy: `${E}Q212` }),
      binding({ item: `${E}Q7835`, claimedBy: `${E}Q212` }), // dup
      binding({ item: `${E}Q7835`, claimedBy: `${E}Q159` }),
    ];
    const result = parseDisputeClaimBindings(bindings);
    expect(result.get('Q7835')).toEqual(['Q212', 'Q159']);
  });

  it('keeps separate items separate and skips bindings missing item or claimedBy', () => {
    const result = parseDisputeClaimBindings([
      binding({ item: `${E}Q7835`, claimedBy: `${E}Q212` }),
      binding({ item: `${E}Q80389` }), // no claimedBy
      binding({ claimedBy: `${E}Q159` }), // no item
    ]);
    expect(result.size).toBe(1);
    expect(result.get('Q7835')).toEqual(['Q212']);
    expect(result.has('Q80389')).toBe(false);
  });
});

describe('fetchDisputeClaims', () => {
  beforeEach(() => {
    vi.mocked(wikidataUtils.sparqlQuery).mockReset();
  });

  it('returns an empty Map without querying when given no qids', async () => {
    const result = await fetchDisputeClaims([], '[test]');
    expect(result.size).toBe(0);
    expect(wikidataUtils.sparqlQuery).not.toHaveBeenCalled();
  });

  it('drops QIDs that do not match /^Q\\d+$/, warns, and only queries the valid ones', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(wikidataUtils.sparqlQuery).mockResolvedValue([]);

    await fetchDisputeClaims(['Q7835', 'DROP TABLE items', 'Q212; -- ', 'not-a-qid'], '[test]');

    expect(wikidataUtils.sparqlQuery).toHaveBeenCalledTimes(1);
    const [queryArg] = vi.mocked(wikidataUtils.sparqlQuery).mock.calls[0];
    expect(queryArg).toContain('wd:Q7835');
    expect(queryArg).not.toContain('DROP TABLE');
    expect(queryArg).not.toContain('Q212; --');
    expect(queryArg).not.toContain('not-a-qid');
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('returns an empty Map without querying when every qid is invalid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await fetchDisputeClaims(['nope', ''], '[test]');
    expect(result.size).toBe(0);
    expect(wikidataUtils.sparqlQuery).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('parses a successful response into the qid -> claimants map', async () => {
    vi.mocked(wikidataUtils.sparqlQuery).mockResolvedValue([
      binding({ item: `${E}Q7835`, claimedBy: `${E}Q212` }),
    ]);
    const result = await fetchDisputeClaims(['Q7835'], '[test]');
    expect(result.get('Q7835')).toEqual(['Q212']);
  });
});
