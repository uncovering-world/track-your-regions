/**
 * #1719: a place's lifetime as its item states it, read through the subset's
 * reader from the statements the development subset holds (dump of
 * 2026-10-26, read on 2026-11-16), cut to what the rule and the gone rules
 * read: the dated statements (P571, P1619, P576, P3999), the state of use
 * (P5817) and of conservation (P5816), the heritage designations (P1435) and
 * the significant events of a destruction (P793). Times keep their calendar
 * model only where it is Julian.
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
import { goneReason, goneWorkReason } from './gone.js';
import { lifetimeOf, readLifetimes } from './lifetime.js';

const JULIAN = 'http://www.wikidata.org/entity/Q1985786';

const STATEMENTS: Record<string, Record<string, unknown>> = {
  // Göbekli Tepe
  Q214944: {"P571": [{"id": "Q214944$899b45c8-40f2-5adb-2e34-0709364b6161", "value": {"time": "-9999-01-01T00:00:00Z", "precision": 6}, "qualifiers": {"P1480": ["Q5727902"]}}], "P576": [{"id": "Q214944$50d835b9-4a90-f4cb-aade-f9eaac2895ac", "value": {"time": "-7000-00-00T00:00:00Z", "precision": 6, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P1435": [{"id": "Q214944$f32e1a26-4f99-a263-2974-ef727e96d039", "value": "Q9259", "rank": "preferred", "qualifiers": {"P580": [{"time": "+2018-07-01T00:00:00Z", "precision": 11}]}}, {"id": "Q214944$f78ebcc9-460c-e12d-d7fc-0dc4ea3a80b4", "value": "Q1459900", "rank": "deprecated", "qualifiers": {"P580": [{"time": "+2011-04-15T00:00:00Z", "precision": 11}], "P582": [{"time": "+2018-06-30T00:00:00Z", "precision": 11}]}}], "P5816": [{"id": "Q214944$F223D3CB-5D4F-420A-AA8D-B7A61F6FCE2D", "value": "Q56557591"}]},
  // Pergamon Museum
  Q157298: {"P571": [{"id": "Q157298$65DE6523-3836-443C-BE8F-F3086D3CB287", "value": {"time": "+1910-01-01T00:00:00Z", "precision": 9}}], "P1435": [{"id": "Q157298$48E724EB-DA6E-493F-8EFF-23E3262A9024", "value": "Q811165"}], "P1619": [{"id": "Q157298$A6DA5594-656C-479F-8B3B-E050F84BE7D2", "value": {"time": "+1910-00-00T00:00:00Z", "precision": 9}}]},
  // Nelson's Pillar
  Q2350741: {"P571": [{"id": "Q2350741$588C6C07-E5DD-4A68-B793-D270B9FDD5C4", "value": {"time": "+1808-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q2350741$e0964237-4486-5bd4-7a4f-6633f7856e35", "value": {"time": "+1966-03-08T00:00:00Z", "precision": 11}}], "P793": [{"id": "Q2350741$1333e4a7-4020-c552-75e0-9f467d1dd2b4", "value": "Q331483"}], "P1619": [{"id": "Q2350741$409e90d1-46ab-7d18-8527-20fa02a9516e", "value": {"time": "+1809-10-21T00:00:00Z", "precision": 11}}], "P3999": [{"id": "Q2350741$7F3F88C1-F0D2-482B-84BF-EA1612809197", "value": {"time": "+1966-03-08T00:00:00Z", "precision": 11}}]},
  // Arch of Reunification
  Q94731: {"P571": [{"id": "Q94731$b76f4bd3-4c52-094b-2c00-875000cd3606", "value": {"time": "+2001-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q94731$3df03b58-4015-4cb2-211a-fe043c4ba908", "value": {"time": "+2024-01-00T00:00:00Z", "precision": 10}}], "P793": [{"id": "Q94731$db319ee6-4763-2e11-3f30-add81a1a0f22", "value": "Q17781833"}], "P1619": [{"id": "Q94731$f23a86eb-4c48-e88d-d0e3-d907a46a8171", "value": {"time": "+2001-08-00T00:00:00Z", "precision": 10}}], "P5816": [{"id": "Q94731$c612a1b9-42d6-e3f4-66e1-7b7369c17ae2", "value": "Q56556915"}]},
  // Cathedral of Christ the Saviour
  Q194474: {"P571": [{"id": "Q194474$0D32E330-80AF-431D-A6FB-257E18677920", "value": {"time": "+2000-08-19T00:00:00Z", "precision": 11}}], "P576": [{"id": "Q194474$cb21ee04-40c9-437a-d682-4cc31e439511", "value": {"time": "+1931-12-05T00:00:00Z", "precision": 11}}], "P1435": [{"id": "Q194474$B153B509-0823-4526-940D-87F8EFBC4F50", "value": "Q105835774"}], "P1619": [{"id": "Q194474$903BF5EC-F2AC-49AD-9037-EFFF5E0E42D8", "value": {"time": "+1883-00-00T00:00:00Z", "precision": 9}}], "P5816": [{"id": "Q194474$3449F2D7-3743-4AC2-AFFB-1C5340F3A7DF", "value": "Q56556915"}, {"id": "Q194474$64675777-43b7-5597-b5d6-4031abefe1c7", "value": "Q1370468", "qualifiers": {"P580": [{"time": "+1995-00-00T00:00:00Z", "precision": 9}]}}]},
  // Notre-Dame de Paris
  Q2981: {"P571": [{"id": "Q2981$14AB2599-D418-4F62-8805-73DB2B5FB80A", "value": {"time": "+1163-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P1435": [{"id": "Q2981$BBB99B60-359B-40E6-8856-FAB034CA8D3C", "value": "Q10387684", "qualifiers": {"P580": [{"time": "+1862-00-00T00:00:00Z", "precision": 9}]}}], "P1619": [{"id": "Q2981$fb067d68-4cab-e6b3-3362-82be53a1b4f0", "value": {"time": "+2024-12-07T00:00:00Z", "precision": 11}}]},
  // Registan
  Q1373583: {"P571": [{"id": "Q1373583$c479308e-4ab3-e7c5-4397-8fad4b6f2dda", "value": {"time": "+1417-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P576": [{"id": "Q1373583$b0c92fe5-4730-7cde-019c-cb40d489b03a", "value": {"time": "+1420-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P1435": [{"id": "Q1373583$AB1BEA44-0104-4D5E-88E8-80F0B10E5AB2", "value": "Q122215934"}]},
  // Bath Abbey
  Q334399: {"P571": [{"id": "Q334399$A6C38473-BB77-4107-9F2F-08CC86634D0B", "value": {"time": "+1572-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P576": [{"id": "Q334399$0DF2237F-613A-4AB5-A855-2F94161C62E7", "value": {"time": "+1539-01-01T00:00:00Z", "precision": 9}}], "P1435": [{"id": "Q334399$513BDEEA-7A09-4EDE-A9C0-62833794FD99", "value": "Q15700818", "qualifiers": {"P580": [{"time": "+1950-06-12T00:00:00Z", "precision": 11}]}}]},
  // Kakhovka Dam
  Q119210467: {"P571": [{"id": "Q119210467$38569E6A-AE3D-4017-9598-DEAC94E8B15C", "value": {"time": "+1950-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q119210467$C57C1910-6CCB-4A6A-A5E4-3E41A1F24056", "value": {"time": "+2023-06-06T00:00:00Z", "precision": 11}}], "P5816": [{"id": "Q119210467$3EDFA098-6334-45F9-AAAE-CBE30A703448", "value": "Q56556915"}]},
  // Dohány Street Synagogue
  Q754397: {"P571": [{"id": "Q754397$196619EF-823C-444E-8444-F22C5E1E4817", "value": {"time": "+1854-00-00T00:00:00Z", "precision": 9}}], "P580": [{"id": "Q754397$9b09786e-462c-48f7-9c7d-7d48e8ae452a", "value": {"time": "+1854-00-00T00:00:00Z", "precision": 9}}], "P582": [{"id": "Q754397$a9aa9c03-4265-d07f-33d2-0b04db5bffab", "value": {"time": "+1859-00-00T00:00:00Z", "precision": 9}}], "P1619": [{"id": "Q754397$72d55406-4d17-e17a-7793-d404dd69eecc", "value": {"time": "+1859-09-06T00:00:00Z", "precision": 11}}]},
  // Not items: a Julian leap day the Gregorian calendar lacks, and a day the Julian calendar lacks.
  Q9719001: {"P571": [{"id": "Q9719001$aa01", "value": {"time": "+1500-02-29T00:00:00Z", "precision": 11, "calendarmodel": JULIAN}}]},
  Q9719002: {"P571": [{"id": "Q9719002$aa02", "value": {"time": "+1500-02-30T00:00:00Z", "precision": 11, "calendarmodel": JULIAN}}, {"id": "Q9719002$aa03", "value": {"time": "+1501-00-00T00:00:00Z", "precision": 9}}]},
  // Not items: Mohenjo-daro's end time about 1700 BC, alone; the Arch of Neutrality's 1998, 2010 and end in 2010.
  Q9719004: {"P582": [{"id": "Q9719004$aa05", "value": {"time": "-1700-00-00T00:00:00Z", "precision": 7}, "qualifiers": {"P1480": ["Q5727902"]}}]},
  Q9719005: {"P571": [{"id": "Q9719005$aa06", "value": {"time": "+1998-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719005$aa07", "value": {"time": "+2010-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719005$aa08", "value": {"time": "+2010-00-00T00:00:00Z", "precision": 9}}]},
  // Not an item: begun in 1854, ended in 1859 stated to the year, and opened on 6 September 1859.
  Q9719006: {"P571": [{"id": "Q9719006$aa09", "value": {"time": "+1854-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719006$aa10", "value": {"time": "+1859-00-00T00:00:00Z", "precision": 9}}], "P1619": [{"id": "Q9719006$aa11", "value": {"time": "+1859-09-06T00:00:00Z", "precision": 11}}]},
  // Not items: a work set up in 2019 (to the year) and removed on 14 June 2019; an inception in 1800, an end in
  // the 1950s and an opening in 1955; an inception to the 1600s century and an end in 1550; an inception on a
  // 30 February of the Julian calendar beside the start and end of a building.
  Q9719007: {"P571": [{"id": "Q9719007$aa12", "value": {"time": "+2019-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719007$aa13", "value": {"time": "+2019-06-14T00:00:00Z", "precision": 11}}]},
  Q9719008: {"P571": [{"id": "Q9719008$aa14", "value": {"time": "+1800-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719008$aa15", "value": {"time": "+1950-00-00T00:00:00Z", "precision": 8}}], "P1619": [{"id": "Q9719008$aa16", "value": {"time": "+1955-00-00T00:00:00Z", "precision": 9}}]},
  Q9719009: {"P571": [{"id": "Q9719009$aa17", "value": {"time": "+1600-00-00T00:00:00Z", "precision": 7}}], "P576": [{"id": "Q9719009$aa18", "value": {"time": "+1550-00-00T00:00:00Z", "precision": 9}}]},
  Q9719010: {"P571": [{"id": "Q9719010$aa19", "value": {"time": "+1500-02-30T00:00:00Z", "precision": 11, "calendarmodel": JULIAN}}], "P580": [{"id": "Q9719010$aa20", "value": {"time": "+1854-00-00T00:00:00Z", "precision": 9}}], "P582": [{"id": "Q9719010$aa21", "value": {"time": "+1859-00-00T00:00:00Z", "precision": 9}}]},
  // Not an item: begun 1800, ended 1900, started 1950, ended 2010 and started 2010, all to the year.
  Q9719011: {"P571": [{"id": "Q9719011$aa22", "value": {"time": "+1800-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719011$aa23", "value": {"time": "+1950-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719011$aa24", "value": {"time": "+2010-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719011$aa25", "value": {"time": "+1900-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719011$aa26", "value": {"time": "+2010-00-00T00:00:00Z", "precision": 9}}]},
  // Not an item: begun 1800, ended 2000, started 2000 and again 2005, all to the year.
  Q9719012: {"P571": [{"id": "Q9719012$aa27", "value": {"time": "+1800-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719012$aa28", "value": {"time": "+2000-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719012$aa29", "value": {"time": "+2005-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719012$aa30", "value": {"time": "+2000-00-00T00:00:00Z", "precision": 9}}]},
  // Not an item: the Tomb of the Unknown Soldier's 11 November 1920, stated to ten thousand years.
  Q9719003: {"P571": [{"id": "Q9719003$aa04", "value": {"time": "+1920-11-11T00:00:00Z", "precision": 5}}]},
};

beforeEach(() => {
  claimsOf.clear();
  for (const [qid, claims] of Object.entries(STATEMENTS)) claimsOf.set(qid, claims);
});

/** Each item's lifetime as the run would report it: a place kind's gone rule, or a works kind's. */
async function lifetimes(qids: string[], works = false) {
  const facts = await subsetStandingFacts(qids);
  return Object.fromEntries(qids.map((qid) => {
    const known = facts.get(qid);
    if (!known) return [qid, 'unread'];
    return [qid, lifetimeOf(known, works ? goneWorkReason(known) : goneReason(known), 2026)];
  }));
}

const year = (y: number, rest: Record<string, unknown> = {}) =>
  expect.objectContaining({ year: y, month: null, day: null, span: null, circa: false, ending: null, ...rest });

describe('a place\'s lifetime as its item states it (#1719)', () => {
  it('reads Göbekli Tepe as begun about the 10th millennium BC and in use until the 7th', async () => {
    expect((await lifetimes(['Q214944'])).Q214944).toEqual({
      began: year(-9999, { span: 'millennium', circa: true, property: 'P571', statement: 'Q214944$899b45c8-40f2-5adb-2e34-0709364b6161' }),
      use_ended: year(-7000, { span: 'millennium', property: 'P576', statement: 'Q214944$50d835b9-4a90-f4cb-aade-f9eaac2895ac' }),
    });
  });

  it('reads the Pergamon Museum as begun in 1910, and nothing of its closure, which Wikidata does not state', async () => {
    expect((await lifetimes(['Q157298'])).Q157298).toEqual({ began: year(1910, { property: 'P571' }) });
  });

  it('reads the end of Nelson\'s Pillar and of the Arch of Reunification as the end of the place, how they went with it', async () => {
    const read = await lifetimes(['Q2350741', 'Q94731'], true);
    expect(read.Q2350741).toEqual({
      began: year(1808, { property: 'P571' }),
      ended: year(1966, { month: 3, day: 8, ending: 'destroyed', property: 'P576' }),
    });
    expect(read.Q94731).toEqual({
      began: year(2001, { property: 'P571' }),
      ended: year(2024, { month: 1, ending: 'destroyed', property: 'P576' }),
    });
  });

  it('reads the Cathedral of Christ the Saviour as built by 1883 and rebuilt in 2000, its demolition outlived', async () => {
    expect((await lifetimes(['Q194474'])).Q194474).toEqual({
      began: year(1883, { property: 'P1619' }),
      rebuilt: year(2000, { month: 8, day: 19, property: 'P571' }),
    });
  });

  it('never reads Notre-Dame\'s reopening of 2024 as its beginning', async () => {
    expect((await lifetimes(['Q2981'])).Q2981).toEqual({ began: year(1163, { property: 'P571' }) });
  });

  it('keeps the end of a role or a use apart from the place: the Registan stands', async () => {
    expect((await lifetimes(['Q1373583'])).Q1373583).toEqual({
      began: year(1417, { property: 'P571' }),
      use_ended: year(1420, { property: 'P576' }),
    });
  });

  it('drops an end before the beginning, which ends an earlier building: Bath Abbey\'s monastery, dissolved in 1539', async () => {
    expect((await lifetimes(['Q334399'])).Q334399).toEqual({ began: year(1572, { property: 'P571' }) });
  });

  it('reads the Kakhovka Dam\'s destruction as an end of use, since no gone rule reads its state of conservation', async () => {
    expect((await lifetimes(['Q119210467'])).Q119210467).toEqual({
      began: year(1950, { property: 'P571' }),
      use_ended: year(2023, { month: 6, day: 6, property: 'P576' }),
    });
  });

  it('reads no start or end time on an item that states an inception: the Dohány Street Synagogue\'s are its building', async () => {
    expect((await lifetimes(['Q754397'])).Q754397).toEqual({ began: year(1854, { property: 'P571' }) });
  });

  it('reads a start and an end time where the item states nothing else', async () => {
    expect((await lifetimes(['Q9719004'])).Q9719004).toEqual({ use_ended: year(-1700, { span: 'century', circa: true, property: 'P582' }) });
  });

  it('reads neither a rebuild nor an end of use where a start shares the last end\'s period, since the item does not say which came first', async () => {
    const read = await lifetimes(['Q9719005', 'Q9719006', 'Q9719008']);
    // Set up in 1998, taken down and set up again in 2010, and standing: the end and the second inception are one year.
    expect(read.Q9719005).toEqual({ began: year(1998, { property: 'P571' }) });
    // An end known to the year and an opening that year known to the day.
    expect(read.Q9719006).toEqual({ began: year(1854, { property: 'P571' }) });
    // An end in the 1950s and an opening in 1955.
    expect(read.Q9719008).toEqual({ began: year(1800, { property: 'P571' }) });
  });

  it('still reads a rebuild whose order the item does state, beside a last end whose order it does not', async () => {
    const read = await lifetimes(['Q9719011', 'Q9719012']);
    expect(read.Q9719011).toEqual({
      began: year(1800, { property: 'P571' }),
      rebuilt: year(1950, { property: 'P571' }),
    });
    // The start of 2000 leaves its order with the end of 2000 unsaid; the start of 2005 does not.
    expect(read.Q9719012).toEqual({
      began: year(1800, { property: 'P571' }),
      rebuilt: year(2005, { property: 'P571' }),
    });
  });

  it('keeps an end in the same period as the beginning: a work set up in 2019 and removed on 14 June 2019', async () => {
    expect((await lifetimes(['Q9719007'], true)).Q9719007).toEqual({
      began: year(2019, { property: 'P571' }),
      ended: year(2019, { month: 6, day: 14, ending: 'removed', property: 'P576' }),
    });
  });

  it('keeps an end within the century the beginning is known to', async () => {
    expect((await lifetimes(['Q9719009'])).Q9719009).toEqual({
      began: year(1600, { span: 'century', property: 'P571' }),
      use_ended: year(1550, { property: 'P576' }),
    });
  });

  it('reads no start or end time on an item that states an inception, even one whose date cannot be read', async () => {
    expect((await lifetimes(['Q9719010'])).Q9719010).toEqual({});
  });

  it('turns a Julian day into the Gregorian day it is, and skips a day the Julian calendar lacks', async () => {
    const read = await lifetimes(['Q9719001', 'Q9719002']);
    expect(read.Q9719001).toEqual({ began: year(1500, { month: 3, day: 10, property: 'P571' }) });
    expect(read.Q9719002).toEqual({ began: year(1501, { property: 'P571' }) });
  });

  it('reads a recent date stated to ten thousand years as its year', async () => {
    expect((await lifetimes(['Q9719003'])).Q9719003).toEqual({ began: year(1920, { property: 'P571' }) });
  });
});

describe('the lifetimes a run reads on the live service (#1719)', () => {
  it('reads an item that states no date as an empty view, and leaves one the service does not answer unread', async () => {
    const e = (qid: string) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${qid}` });
    // Q9719201 exists and states no date any more; Q9719202 is a redirect, which the service answers with no row.
    const sparql = vi.fn(async () => [{ e: e('Q9719201'), known: { type: 'literal', value: '3' } }]);
    const read = await readLifetimes(sparql, [{ key: 'kept', qid: 'Q9719201' }, { key: 'gone', qid: 'Q9719202' }]);
    expect(read.get('kept')).toEqual({});
    expect(read.has('gone')).toBe(false);
  });
});
