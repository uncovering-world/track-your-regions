import { describe, it, expect } from 'vitest';
import { parseWikidataBindings } from './wikidataSource.js';
import type { SparqlBinding } from '../sync/wikidataUtils.js';

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
});
