/**
 * #2259: a place Wikidata says is gone is refused, read from its own
 * statements, on the places the rule was measured on (development subset,
 * 2026-11-02): what each item states of its end, its state of use, its state
 * of conservation and its heritage designation.
 */

import { describe, it, expect } from 'vitest';
import type { SparqlBinding } from '../wikidataUtils.js';
import { fetchStandingFacts, goneReason, refuseGone, type StandingFacts } from './gone.js';

const DEMOLISHED = 'Q56556915';
const PERMANENTLY_CLOSED = 'Q104664889';
const TEMPORARILY_CLOSED = 'Q55653430';
const OUT_OF_SERVICE = 'Q56651571';
const OPEN_TO_THE_PUBLIC = 'Q55570821';
const RUINOUS = 'Q56557159';
const PRESERVED = 'Q56557591';
const PROPOSED = 'Q811683';

const facts = (over: Partial<StandingFacts>): StandingFacts => ({
  ended: false, endedYear: null, endedAt: null, use: [], conservation: [], heritage: false,
  designatedSince: [], inceptions: [], placedSince: [], events: [], ...over,
});

describe('goneReason', () => {
  it('refuses the four places a world bar would admit for the disaster their articles tell of', () => {
    // The Francis Scott Key Bridge: ended 2024-03-26, temporarily closed, no designation.
    expect(goneReason(facts({ ended: true, endedYear: 2024, use: [TEMPORARILY_CLOSED] })))
      .toBe('gone: Wikidata ends its existence in 2024, its state of use says temporarily closed, and nothing says it stands');
    // The St. Francis Dam: its state of use says demolished or destroyed.
    expect(goneReason(facts({ use: [DEMOLISHED] }))).toBe("gone: Wikidata's state of use says demolished or destroyed");
    // The Teton Dam: out of service, and ruinous.
    expect(goneReason(facts({ use: [OUT_OF_SERVICE], conservation: [RUINOUS] })))
      .toBe("gone: Wikidata's state of use says out of service, and its state of conservation ruinous");
    // The reason names the state that refused it, whatever the item states first.
    expect(goneReason(facts({ use: [TEMPORARILY_CLOSED, OUT_OF_SERVICE], conservation: [RUINOUS] })))
      .toBe("gone: Wikidata's state of use says out of service, and its state of conservation ruinous");
    // Old St. Peter's Basilica: ended 1505, permanently closed, demolished, no designation.
    expect(goneReason(facts({ ended: true, endedYear: 1505, use: [PERMANENTLY_CLOSED], conservation: [DEMOLISHED] })))
      .toMatch(/^gone: Wikidata ends its existence in 1505, its state of use says permanently closed/);
  });

  it('keeps a place rebuilt or a ruin worth seeing: the Frauenkirche, the Parthenon', () => {
    // The Frauenkirche in Dresden: preserved, designated; no end of its own.
    expect(goneReason(facts({ conservation: [PRESERVED], heritage: true }))).toBeNull();
    // The Parthenon: open to the public, designated.
    expect(goneReason(facts({ use: [OPEN_TO_THE_PUBLIC], heritage: true }))).toBeNull();
  });

  it('never reads an end of existence alone as gone: the end of what a building housed is not the end of the building', () => {
    // Hagia Sophia: ended as a church, preserved, designated.
    expect(goneReason(facts({ ended: true, conservation: [PRESERVED], heritage: true }))).toBeNull();
    // The Registan and Coventry's bombed cathedral: ended, designated, no state of use.
    expect(goneReason(facts({ ended: true, heritage: true }))).toBeNull();
    // Fountains Abbey: dissolved, closed as a monastery, a demolished structure — and a designated ruin a visitor walks.
    expect(goneReason(facts({ ended: true, use: [PERMANENTLY_CLOSED], conservation: [DEMOLISHED], heritage: true }))).toBeNull();
    // St Michael's Golden-Domed Monastery: ended and demolished, rebuilt since; no state of use agrees that it closed.
    expect(goneReason(facts({ ended: true, conservation: [DEMOLISHED] }))).toBeNull();
  });

  it('refuses a place never built, whatever else it states', () => {
    expect(goneReason(facts({ use: [PROPOSED], heritage: true }))).toBe("never built: Wikidata's state of use says proposed building or structure");
  });
});

describe('fetchStandingFacts on the live service', () => {
  it('reads every statement of an item into one answer', async () => {
    const e = (qid: string) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${qid}` });
    const rows: SparqlBinding[] = [
      { e: e('Q5482413'), end: { type: 'literal', value: '2024-03-26T00:00:00Z' }, use: e(TEMPORARILY_CLOSED) },
      { e: e('Q10288'), use: e(OPEN_TO_THE_PUBLIC), herit: e('Q29048715') },
    ] as SparqlBinding[];
    const answer = await fetchStandingFacts(() => Promise.resolve(rows), ['Q5482413', 'Q10288']);
    expect(answer.get('Q5482413')).toEqual(facts({
      ended: true, endedYear: 2024, endedAt: { year: 2024, month: 3, day: 26, precision: 9 }, use: [TEMPORARILY_CLOSED],
    }));
    expect(answer.get('Q10288')).toEqual(facts({ use: [OPEN_TO_THE_PUBLIC], heritage: true, designatedSince: [null] }));
  });

  it('reads the year of an end the service writes with its sign', async () => {
    const rows: SparqlBinding[] = [
      { e: { value: 'http://www.wikidata.org/entity/Q5482413' }, end: { value: '+2024-03-26T00:00:00Z' } },
    ];
    const answer = await fetchStandingFacts(() => Promise.resolve(rows), ['Q5482413']);
    expect(answer.get('Q5482413')?.endedYear).toBe(2024);
  });

  it('reads each time with its precision, one statement a row (#2280)', async () => {
    const e = (qid: string) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${qid}` });
    const lit = (value: string) => ({ type: 'literal', value });
    // The Arch of Neutrality: ended 2010, set up again 2010 and placed since 2010 at its new site.
    const rows: SparqlBinding[] = [
      { e: e('Q2564552'), end: lit('2010-01-01T00:00:00Z'), endPrecision: lit('9') },
      { e: e('Q2564552'), inception: lit('1998-01-01T00:00:00Z'), inceptionPrecision: lit('9') },
      { e: e('Q2564552'), inception: lit('2010-01-01T00:00:00Z'), inceptionPrecision: lit('9') },
      { e: e('Q2564552'), placedSince: lit('2010-01-01T00:00:00Z'), placedSincePrecision: lit('9') },
      // The Robert Edward Lee sculpture's designation, twice in the answer, counts once.
      { e: e('Q15272827'), herit: e('Q19558910'), heritSince: lit('1997-05-16T00:00:00Z'), heritSincePrecision: lit('11') },
      { e: e('Q15272827'), herit: e('Q19558910'), heritSince: lit('1997-05-16T00:00:00Z'), heritSincePrecision: lit('11') },
      { e: e('Q15272827'), event: e('Q331483') },
    ] as SparqlBinding[];
    const answer = await fetchStandingFacts(() => Promise.resolve(rows), ['Q2564552', 'Q15272827']);
    const y2010 = { year: 2010, month: 1, day: 1, precision: 9 };
    expect(answer.get('Q2564552')).toEqual(facts({
      ended: true, endedYear: 2010, endedAt: y2010,
      inceptions: [{ year: 1998, month: 1, day: 1, precision: 9 }, y2010], placedSince: [y2010],
    }));
    expect(answer.get('Q15272827')).toEqual(facts({
      heritage: true, designatedSince: [{ year: 1997, month: 5, day: 16, precision: 11 }], events: ['Q331483'],
    }));
  });
});

describe('refuseGone', () => {
  it('moves a gone place from the run\'s items to its refusals, with the reason and its type', async () => {
    const e = (qid: string) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${qid}` });
    const rows = [{ e: e('Q381648'), use: e(DEMOLISHED) }] as SparqlBinding[];
    const items = [
      { qid: 'Q381648', label: 'St. Francis Dam', type: 'dam' },
      { qid: 'Q204871', label: 'Charles Bridge', type: 'bridge' },
    ];
    const filtered = [{ externalId: 'Q3907993', name: 'Polcevera Viaduct', reason: 'destroyed or demolished' }];
    const refused = await refuseGone(items, filtered, () => Promise.resolve(rows),
      { id: (i) => i.qid, name: (i) => i.label, type: (i) => i.type }, '[Bridges]');
    expect(refused).toBe(1);
    expect(items.map((i) => i.qid)).toEqual(['Q204871']);
    expect(filtered).toContainEqual({
      externalId: 'Q381648', name: 'St. Francis Dam', reason: "gone: Wikidata's state of use says demolished or destroyed", type: 'dam',
    });
  });
});
