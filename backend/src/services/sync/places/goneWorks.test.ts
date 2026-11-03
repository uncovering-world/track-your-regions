/**
 * #2280: Public art and Monuments & memorials refuse a work that is no longer
 * where its point is, read from the item's own statements through the subset's
 * reader. The statements below are the subset's (dump of 2026-10-19, read on
 * the development database on 2026-11-03), cut to what the rule reads: the end
 * of existence (P576), the inceptions (P571), the coordinates (P625) with
 * their start and end, the heritage designations (P1435) with theirs, the
 * state of conservation (P5816) and the significant events (P793); a
 * statement id keeps its first characters.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactStatement } from '../../dumps/wikidata/compactEntity.js';

const claimsOf = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock('../subset/entities.js', () => ({
  entitiesOf: vi.fn(async (ids: string[]) => new Map(ids.filter((id) => claimsOf.has(id)).map((id) => [id, {
    sitelinks: 0, entity: { id, labels: {}, descriptions: {}, claims: claimsOf.get(id) as Record<string, CompactStatement[]> },
  }]))),
}));

import { subsetStandingFacts } from '../subset/standing.js';
import { goneWorkReason } from './gone.js';

const STATEMENTS: Record<string, Record<string, unknown>> = {
  // Utah monolith
  Q102285438: {"P571": [{"id": "Q102285438$d7e", "value": {"somevalue": true}}], "P576": [{"id": "Q102285438$3ea", "value": {"time": "+2020-11-27T00:00:00Z", "precision": 11}}], "P625": [{"id": "Q102285438$848", "value": {"latitude": 38.343111111111114, "longitude": -109.66625}, "qualifiers": {"P580": [{"time": "+2016-00-00T00:00:00Z", "precision": 9}], "P582": [{"time": "+2020-11-27T00:00:00Z", "precision": 11}]}}], "P793": [{"id": "Q102285438$f61", "value": "Q38131096"}, {"id": "Q102285438$e74", "value": "Q1463544"}, {"id": "Q102285438$475", "value": "Q55237917"}, {"id": "Q102285438$a9a", "value": "Q3625549"}]},
  // El Colotero
  Q137437817: {"P571": [{"id": "Q137437817$28c", "value": {"time": "+2004-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q137437817$026", "value": {"time": "+2025-12-16T00:00:00Z", "precision": 11}}], "P625": [{"id": "Q137437817$16b", "value": {"latitude": 20.90538888888889, "longitude": -97.67930555555556}}]},
  // Robert Edward Lee sculpture
  Q15272827: {"P1435": [{"id": "Q15272827$CB3", "value": "Q19558910", "qualifiers": {"P580": [{"time": "+1997-05-16T00:00:00Z", "precision": 11}]}}, {"id": "Q15272827$cd8", "value": "Q1129142", "qualifiers": {"P580": [{"time": "+1982-07-28T00:00:00Z", "precision": 11}]}}, {"id": "Q15272827$cf1", "value": "Q7934314", "qualifiers": {"P580": [{"time": "+1996-06-19T00:00:00Z", "precision": 11}]}}], "P571": [{"id": "Q15272827$981", "value": {"time": "+1924-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q15272827$3bc", "value": {"time": "+2023-10-00T00:00:00Z", "precision": 10}}], "P625": [{"id": "Q15272827$306", "value": {"latitude": 38.031666666666666, "longitude": -78.48055555555555}}]},
  // Statue of the Empress Joséphine
  Q16964842: {"P1435": [{"id": "Q16964842$922", "value": "Q10387575", "qualifiers": {"P580": [{"time": "+1992-12-31T00:00:00Z", "precision": 11}]}}], "P571": [{"id": "Q16964842$eb9", "value": {"time": "+1850-00-00T00:00:00Z", "precision": 8}}], "P576": [{"id": "Q16964842$d30", "value": {"time": "+2020-07-26T00:00:00Z", "precision": 11}}], "P625": [{"id": "Q16964842$f06", "value": {"latitude": 14.6039, "longitude": -61.0679}}]},
  // Swedish lion statue in Narva
  Q18333243: {"P571": [{"id": "Q18333243$df9", "value": {"time": "+1936-00-00T00:00:00Z", "precision": 9}}, {"id": "Q18333243$be5", "value": {"time": "+2000-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q18333243$86f", "value": {"time": "+1944-00-00T00:00:00Z", "precision": 9}}], "P625": [{"id": "Q18333243$bfd", "value": {"latitude": 59.3729677, "longitude": 28.2006028}}]},
  // Timewheel
  Q186596: {"P571": [{"id": "Q186596$80D", "value": {"time": "+2004-01-01T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q186596$f29", "value": {"time": "+2021-00-00T00:00:00Z", "precision": 9}}], "P625": [{"id": "Q186596$AC1", "value": {"latitude": 47.51277778, "longitude": 19.08027778}}]},
  // Barmaley Fountain
  Q1974183: {"P571": [{"id": "Q1974183$B2C", "value": {"time": "+1930-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q1974183$f6b", "value": {"time": "+1951-00-00T00:00:00Z", "precision": 9}}], "P5816": [{"id": "Q1974183$745", "value": "Q56556915"}], "P625": [{"id": "Q1974183$D14", "value": {"latitude": 48.7123, "longitude": 44.514}}]},
  // Nelson's Pillar
  Q2350741: {"P571": [{"id": "Q2350741$588", "value": {"time": "+1808-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q2350741$e09", "value": {"time": "+1966-03-08T00:00:00Z", "precision": 11}}], "P625": [{"id": "q2350741$0CC", "value": {"latitude": 53.349805555555555, "longitude": -6.26025}, "qualifiers": {"P582": [{"time": "+1966-03-08T00:00:00Z", "precision": 11}]}}], "P793": [{"id": "Q2350741$133", "value": "Q331483"}]},
  // Arch of Neutrality
  Q2564552: {"P571": [{"id": "Q2564552$2b3", "value": {"time": "+1998-00-00T00:00:00Z", "precision": 9}}, {"id": "Q2564552$69e", "value": {"time": "+2010-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q2564552$ab9", "value": {"time": "+2010-00-00T00:00:00Z", "precision": 9}}], "P625": [{"id": "q2564552$DAB", "value": {"latitude": 37.936944, "longitude": 58.38}, "qualifiers": {"P580": [{"time": "+1998-12-12T00:00:00Z", "precision": 11}], "P582": [{"time": "+2010-00-00T00:00:00Z", "precision": 9}]}}, {"id": "Q2564552$d55", "rank": "preferred", "value": {"latitude": 37.88218, "longitude": 58.3333}, "qualifiers": {"P580": [{"time": "+2010-00-00T00:00:00Z", "precision": 9}]}}]},
  // Moscow Triumphal Gate
  Q2627416: {"P1435": [{"id": "Q2627416$3F3", "value": "Q23668083"}], "P571": [{"id": "Q2627416$67b", "value": {"time": "+1834-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q2627416$2F3", "value": {"time": "+1936-00-00T00:00:00Z", "precision": 9}}], "P625": [{"id": "q2627416$618", "value": {"latitude": 59.8914, "longitude": 30.3194}}]},
  // Triumphal Arch of Moscow
  Q2635819: {"P1435": [{"id": "Q2635819$3E8", "value": "Q105835744"}], "P571": [{"id": "Q2635819$948", "value": {"time": "+1834-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q2635819$A09", "value": {"time": "+1936-00-00T00:00:00Z", "precision": 9}}], "P5816": [{"id": "Q2635819$BDD", "value": "Q56556915"}], "P625": [{"id": "Q2635819$1E4", "value": {"latitude": 55.73675, "longitude": 37.519916666667}}]},
  // Running Fence
  Q3453243: {"P571": [{"id": "Q3453243$e46", "value": {"time": "+1976-09-10T00:00:00Z", "precision": 11}}], "P576": [{"id": "Q3453243$743", "value": {"time": "+1976-09-24T00:00:00Z", "precision": 11}}], "P625": [{"id": "q3453243$546", "value": {"latitude": 38.3178, "longitude": -122.924}}]},
  // Catherine II Monument
  Q4343168: {"P571": [{"id": "Q4343168$578", "value": {"time": "+1907-00-00T00:00:00Z", "precision": 9}}, {"id": "Q4343168$ea3", "value": {"time": "+2006-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q4343168$ed6", "value": {"time": "+1920-00-00T00:00:00Z", "precision": 9}}], "P625": [{"id": "Q4343168$4AE", "value": {"latitude": 45.01547222, "longitude": 38.96844444}}]},
  // Monument to the founders of Odesa
  Q4343543: {"P571": [{"id": "Q4343543$99d", "value": {"time": "+1900-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q4343543$7cc", "value": {"time": "+2022-12-29T00:00:00Z", "precision": 11}}], "P625": [{"id": "q4343543$197", "value": {"latitude": 46.487305555556, "longitude": 30.739277777778}}]},
  // Arch of Reunification
  Q94731: {"P571": [{"id": "Q94731$b76", "value": {"time": "+2001-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q94731$3df", "value": {"time": "+2024-01-00T00:00:00Z", "precision": 10}}], "P5816": [{"id": "Q94731$c61", "value": "Q56556915"}], "P625": [{"id": "q94731$218", "value": {"latitude": 38.964527777778, "longitude": 125.71581666667}}], "P793": [{"id": "Q94731$fb4", "value": "Q1417098"}, {"id": "Q94731$9f4", "value": "Q3875186"}, {"id": "Q94731$db3", "value": "Q17781833"}]},
};

beforeEach(() => {
  claimsOf.clear();
  for (const [qid, claims] of Object.entries(STATEMENTS)) claimsOf.set(qid, claims);
});

/** The run's verdict on each item, as the subset's reader and the kinds' rule give it. */
async function verdicts(qids: string[]): Promise<Record<string, string | null>> {
  const facts = await subsetStandingFacts(qids);
  return Object.fromEntries(qids.map((qid) => [qid, facts.has(qid) ? goneWorkReason(facts.get(qid)!) : 'unread']));
}

describe('goneWorkReason on the works the rule was measured on', () => {
  it('refuses a work removed, destroyed or taken down, saying why in words', async () => {
    expect(await verdicts([
      'Q2350741', 'Q16964842', 'Q4343543', 'Q15272827', 'Q102285438', 'Q3453243', 'Q94731', 'Q137437817', 'Q186596',
    ])).toEqual({
      // Nelson's Pillar: blown up; the item states its demolition.
      Q2350741: 'destroyed in 1966',
      // The Empress Joséphine: inscribed as a monument historique in 1992, pulled down in 2020.
      Q16964842: 'removed in 2020',
      // The founders of Odesa: dismantled in 2022.
      Q4343543: 'removed in 2022',
      // The Charlottesville Lee: three designations, every one older than its removal.
      Q15272827: 'removed in 2023',
      // The Utah monolith: placed in 2016, its coordinate ended with it.
      Q102285438: 'removed in 2020',
      // Running Fence: put up on 1976-09-10 and taken down on 1976-09-24.
      Q3453243: 'a temporary work, taken down in 1976',
      // The Arch of Reunification: its state of conservation and an event say destroyed.
      Q94731: 'destroyed in 2024',
      // El Colotero and the Timewheel, the other two admitted works that carry an end.
      Q137437817: 'removed in 2025',
      Q186596: 'removed in 2021',
    });
  });

  it('keeps a work set up again, moved or rebuilt', async () => {
    expect(await verdicts(['Q2627416', 'Q2635819', 'Q4343168', 'Q2564552', 'Q18333243'])).toEqual({
      // The Moscow Triumphal Gate in St Petersburg and the Triumphal Arch of Moscow:
      // ended in 1936, rebuilt, and listed by a register that gives no start.
      Q2627416: null,
      Q2635819: null,
      // The Catherine II Monument in Krasnodar: 1907, gone in 1920, again in 2006.
      Q4343168: null,
      // The Arch of Neutrality: moved in 2010, placed at its new site since then.
      Q2564552: null,
      // The Swedish lion in Narva: 1936, gone in 1944, the replica in 2000.
      Q18333243: null,
    });
  });

  it('refuses the Barmaley Fountain: its item describes the original and nothing of the replica', async () => {
    // The replica set up in 2013 stands in Volgograd, but the item states only
    // the fountain of 1930, its end in 1951 and that it was destroyed. The
    // refusal is a fact about the item, not a fault of the rule: a curator's
    // pin puts it back, and the item corrected on Wikidata (a second
    // inception) keeps it on the next run.
    expect(await verdicts(['Q1974183'])).toEqual({ Q1974183: 'destroyed in 1951' });
    claimsOf.set('Q1974183', {
      ...STATEMENTS.Q1974183,
      P571: [...(STATEMENTS.Q1974183.P571 as unknown[]), { id: 'Q1974183$new', value: { time: '+2013-00-00T00:00:00Z', precision: 9 } }],
    });
    expect(await verdicts(['Q1974183'])).toEqual({ Q1974183: null });
  });

  it('refuses a temporary work whose only inception and end are stated to the same year', async () => {
    // Its own first inception is no rebuild: set up and taken down in 2015, it is gone.
    claimsOf.set('Q99999901', {
      P571: [{ id: 'Q99999901$1', value: { time: '+2015-00-00T00:00:00Z', precision: 9 } }],
      P576: [{ id: 'Q99999901$2', value: { time: '+2015-00-00T00:00:00Z', precision: 9 } }],
    });
    expect(await verdicts(['Q99999901'])).toEqual({ Q99999901: 'removed in 2015' });
  });

  it('keeps a work whose only inception is after its end: an item that dates only the replica standing today', async () => {
    claimsOf.set('Q99999902', {
      P571: [{ id: 'Q99999902$1', value: { time: '+2013-00-00T00:00:00Z', precision: 9 } }],
      P576: [{ id: 'Q99999902$2', value: { time: '+1951-00-00T00:00:00Z', precision: 9 } }],
    });
    expect(await verdicts(['Q99999902'])).toEqual({ Q99999902: null });
  });

  it('keeps a work designated again after its end, whichever start its designation names first', async () => {
    // One designation, two starts: 1900 before the end in 1990 and 2010 after it.
    claimsOf.set('Q99999903', {
      P1435: [{ id: 'Q99999903$1', value: 'Q19558910', qualifiers: { P580: [
        { time: '+1900-00-00T00:00:00Z', precision: 9 }, { time: '+2010-00-00T00:00:00Z', precision: 9 },
      ] } }],
      P576: [{ id: 'Q99999903$2', value: { time: '+1990-00-00T00:00:00Z', precision: 9 } }],
    });
    expect(await verdicts(['Q99999903'])).toEqual({ Q99999903: null });
  });

  it('reads a place\'s gone first: a work whose state of use says demolished is gone however it reads as a work', async () => {
    claimsOf.set('Q381648', { P5817: [{ id: 'Q381648$1', value: 'Q56556915' }] });
    expect(await verdicts(['Q381648'])).toEqual({ Q381648: "gone: Wikidata's state of use says demolished or destroyed" });
  });

  it('keeps a work whose item states no end, and one whose only end is deprecated', async () => {
    // The Nathan Bedford Forrest Statue was taken down in 2021, and its item
    // states no end: Jev's reading on the arrival's card is the curator's
    // question there (#1768), never a refusal by the rule.
    claimsOf.set('Q39060616', { P571: [{ id: 'Q39060616$1b4', value: { time: '+1998-00-00T00:00:00Z', precision: 9 } }] });
    // St. Paul's Church in Frankfurt: its end in the 1944 bombing is deprecated, and it stands.
    claimsOf.set('Q198106', {
      P576: [{ id: 'Q198106$1', rank: 'deprecated', value: { time: '+1944-03-22T00:00:00Z', precision: 11 } }],
      P5816: [{ id: 'Q198106$2', value: 'Q56556915' }],
      P1435: [{ id: 'Q198106$3', value: 'Q85171284' }],
    });
    expect(await verdicts(['Q39060616', 'Q198106'])).toEqual({ Q39060616: null, Q198106: null });
  });
});
