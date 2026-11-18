/**
 * Tests for a World Heritage Site's history on the lists, read from
 * Wikidata's statements (#2127). The rows are the query's own answers for the
 * sites named, read on 2026-11-18.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() }, rollbackQuietly: vi.fn() }));

import { componentItemsOf, historyOf, siteStatements, statementsOf } from './heritageHistory.js';
import { indexWorldHeritageFacts } from './unescoWikidata.js';
import type { ListPeriod, SourcedDate } from '../../db/placePeriodsWriter.js';
import type { SparqlBinding } from './wikidataUtils.js';

const ENTITY = 'http://www.wikidata.org/entity/';
const binding = (row: Record<string, string>): SparqlBinding =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [key, { value }]));

const COLOGNE_STAY = binding({
  item: `${ENTITY}Q4176`, statement: `${ENTITY}statement/Q4176-3934dbc6-43b9-3e81-c5c9-1959a7adb963`,
  start: '2004-01-01T00:00:00Z', startPrecision: '9', end: '2006-01-01T00:00:00Z', endPrecision: '9',
});
const LIVERPOOL_STAY = binding({
  item: `${ENTITY}Q2021552`, statement: `${ENTITY}statement/Q2021552-31f26901-4ca1-3884-619b-1cd88d769ade`,
  start: '2012-01-01T00:00:00Z', startPrecision: '9',
});
const LIVERPOOL_DELISTED = binding({
  item: `${ENTITY}Q2021552`, statement: `${ENTITY}statement/Q2021552-B8A5B5E2-0831-4397-96DD-42CFC88D760F`,
  end: '2021-07-21T00:00:00Z', endPrecision: '11',
});
// The Bamiyan Valley's stay is stated with no dates at all.
const BAMIYAN_STAY = binding({
  item: `${ENTITY}Q50810144`, statement: `${ENTITY}statement/Q50810144-0c71cf9d-41bc-8004-07e9-8c17057a84e2`,
});

// The Buddhas of Bamiyan, the Bamiyan Valley's component 208-001, state its stay from 2003.
const BUDDHAS_STAY = binding({
  item: `${ENTITY}Q484458`, statement: `${ENTITY}statement/Q484458-eba77368-449e-9282-18ff-8682b44fcd03`,
  start: '2003-01-01T00:00:00Z', startPrecision: '9',
});

const STATEMENTS = statementsOf([COLOGNE_STAY, LIVERPOOL_STAY, BAMIYAN_STAY, BUDDHAS_STAY], [LIVERPOOL_DELISTED]);

const year = (y: number): SourcedDate => ({ year: y, month: null, day: null, span: null, circa: false, property: null, statement: null });
const listing = (from: number | null, ended = false): ListPeriod =>
  ({ from: from === null ? null : year(from), ended, until: null, ending: null });
const stay = (from: number | null, ended = false): ListPeriod =>
  ({ from: from === null ? null : year(from), ended, until: null, ending: null });

describe('statementsOf', () => {
  it('reads a stay with its two years, as stated', () => {
    expect(STATEMENTS.stays.get('Q4176')).toEqual([{
      from: { year: 2004, month: null, day: null, span: null, circa: false, property: 'P580', statement: 'Q4176$3934dbc6-43b9-3e81-c5c9-1959a7adb963' },
      ended: true,
      until: { year: 2006, month: null, day: null, span: null, circa: false, property: 'P582', statement: 'Q4176$3934dbc6-43b9-3e81-c5c9-1959a7adb963' },
      ending: null,
    }]);
  });

  it('reads a stay Wikidata leaves open as open, and a delisting to the day', () => {
    expect(STATEMENTS.stays.get('Q2021552')).toEqual([expect.objectContaining({ ended: false, until: null })]);
    expect(STATEMENTS.listingEnds.get('Q2021552')).toEqual([{
      year: 2021, month: 7, day: 21, span: null, circa: false, property: 'P582', statement: 'Q2021552$B8A5B5E2-0831-4397-96DD-42CFC88D760F',
    }]);
  });

  it('keeps a statement that dates nothing as a stay whose start is not known', () => {
    expect(STATEMENTS.stays.get('Q50810144')).toEqual([{ from: null, ended: false, until: null, ending: null }]);
  });

  it('ends at a date not known a stay whose end is stated before its start, and leaves open one that ends ahead', () => {
    const slips = statementsOf([
      binding({
        item: `${ENTITY}Q4176`, statement: `${ENTITY}statement/Q4176-3934dbc6-43b9-3e81-c5c9-1959a7adb963`,
        start: '2006-01-01T00:00:00Z', startPrecision: '9', end: '2004-01-01T00:00:00Z', endPrecision: '9',
      }),
      binding({
        item: `${ENTITY}Q2021552`, statement: `${ENTITY}statement/Q2021552-31f26901-4ca1-3884-619b-1cd88d769ade`,
        start: '2012-01-01T00:00:00Z', startPrecision: '9', end: '2999-01-01T00:00:00Z', endPrecision: '9',
      }),
    ], []);
    expect(slips.stays.get('Q4176')).toEqual([expect.objectContaining({ ended: true, until: null })]);
    expect(slips.stays.get('Q2021552')).toEqual([expect.objectContaining({ ended: false, until: null })]);
  });

  it('reads a time coarser than a year as no date', () => {
    const decade = statementsOf([binding({
      item: `${ENTITY}Q4176`, statement: `${ENTITY}statement/Q4176-3934dbc6-43b9-3e81-c5c9-1959a7adb963`,
      start: '2000-01-01T00:00:00Z', startPrecision: '8',
    })], []);
    expect(decade.stays.get('Q4176')?.[0].from).toBeNull();
  });
});

describe('componentItemsOf', () => {
  it('names the items of a site\'s components, never the site\'s own or a deprecated one', () => {
    const index = indexWorldHeritageFacts([
      binding({ whc: '208rev', item: `${ENTITY}Q50810144` }),
      binding({ whc: '208-001', item: `${ENTITY}Q484458` }),
      binding({ whc: '208-003', item: `${ENTITY}Q65953826`, rank: 'http://wikiba.se/ontology#DeprecatedRank' }),
      binding({ whc: '209-001', item: `${ENTITY}Q1` }),
    ]);
    expect(componentItemsOf(index, '208')).toEqual(['Q484458']);
  });
});

describe('siteStatements', () => {
  it('reads the Bamiyan Valley\'s stay off the Buddhas\' item, beside the site\'s undated one', () => {
    expect(siteStatements(STATEMENTS, ['Q50810144'], ['Q484458']).stays).toEqual([{
      from: expect.objectContaining({ year: 2003, property: 'P580', statement: 'Q484458$eba77368-449e-9282-18ff-8682b44fcd03' }),
      ended: false, until: null, ending: null,
    }]);
  });

  it('keeps the site\'s undated stay where no item dates one', () => {
    expect(siteStatements(STATEMENTS, ['Q50810144']).stays).toEqual([{ from: null, ended: false, until: null, ending: null }]);
  });

  it('reads one stay where several components state the same one', () => {
    // The Medieval Monuments in Kosovo: Dečani and the Patriarchate of Peć each state 2006, open.
    const kosovo = statementsOf([
      binding({
        item: `${ENTITY}Q849517`, statement: `${ENTITY}statement/Q849517-20c61c7f-463c-06dc-96d4-3b9a6343a974`,
        start: '2006-01-01T00:00:00Z', startPrecision: '9',
      }),
      binding({
        item: `${ENTITY}Q969047`, statement: `${ENTITY}statement/Q969047-f8994610-4b78-a70d-69d7-5f7e89d2c63a`,
        start: '2006-01-01T00:00:00Z', startPrecision: '9',
      }),
    ], []);
    expect(siteStatements(kosovo, [], ['Q849517', 'Q969047']).stays)
      .toEqual([expect.objectContaining({ from: expect.objectContaining({ year: 2006 }), ended: false, until: null })]);
  });

  it('fuses stays that overlap into one, to the later end', () => {
    // Two components of site 144: 2004 to 2014, and 2004 to 2015.
    const overlapping = statementsOf([
      binding({
        item: `${ENTITY}Q1741475`, statement: `${ENTITY}statement/Q1741475-990e2291-4ca2-d815-0c8f-33c05f6795cc`,
        start: '2004-01-01T00:00:00Z', startPrecision: '9', end: '2014-01-01T00:00:00Z', endPrecision: '9',
      }),
      binding({
        item: `${ENTITY}Q2301527`, statement: `${ENTITY}statement/Q2301527-ac96eec2-40d3-fbc6-abf6-69702a03cc44`,
        start: '2004-01-01T00:00:00Z', startPrecision: '9', end: '2015-01-01T00:00:00Z', endPrecision: '9',
      }),
    ], []);
    expect(siteStatements(overlapping, [], ['Q1741475', 'Q2301527']).stays).toEqual([expect.objectContaining({
      from: expect.objectContaining({ year: 2004 }), ended: true, until: expect.objectContaining({ year: 2015 }),
    })]);
  });

  it('keeps stays that do not overlap apart', () => {
    const ended = { ...stay(1990), ended: true, until: year(1995) };
    const open = stay(2005);
    const stated = statementsOf([], []);
    stated.stays.set('Q1', [open]);
    stated.stays.set('Q2', [ended]);
    expect(siteStatements(stated, ['Q1'], ['Q2']).stays).toEqual([ended, open]);
  });

  it('reads a designation\'s end on the site\'s own items, never on a component\'s', () => {
    expect(siteStatements(STATEMENTS, [], ['Q2021552']).listingEnd).toBeNull();
    expect(siteStatements(STATEMENTS, ['Q2021552']).listingEnd).toEqual(expect.objectContaining({ year: 2021, month: 7, day: 21 }));
  });
});

describe('historyOf', () => {
  it('adds the stay Cologne Cathedral ended in 2006 to a site out of danger', () => {
    const next = historyOf({ stays: [], listings: [listing(1996)], listed: true }, siteStatements(STATEMENTS, ['Q4176']));
    expect(next.stays).toEqual([expect.objectContaining({
      from: expect.objectContaining({ year: 2004 }), ended: true, until: expect.objectContaining({ year: 2006 }),
    })]);
    expect(next.listings).toEqual([listing(1996)]);
  });

  it('ends Liverpool\'s listing on the day it was delisted, and its stay with it', () => {
    const next = historyOf(
      { stays: [stay(2012)], listings: [{ ...listing(2004), ended: true, ending: 'delisted' }], listed: false },
      siteStatements(STATEMENTS, ['Q2021552']),
    );
    const delisted = expect.objectContaining({ year: 2021, month: 7, day: 21, property: 'P582' });
    expect(next.listings).toEqual([{ from: year(2004), ended: true, until: delisted, ending: 'delisted' }]);
    expect(next.stays).toEqual([expect.objectContaining({
      from: expect.objectContaining({ year: 2012 }), ended: true, until: delisted,
    })]);
  });

  it('keeps the dataset\'s open stay on Bamiyan, since 2003, over the one its items state', () => {
    const next = historyOf(
      { stays: [stay(2003)], listings: [listing(2003)], listed: true }, siteStatements(STATEMENTS, ['Q50810144'], ['Q484458']),
    );
    expect(next.stays).toEqual([stay(2003)]);
  });

  it('ends at a date not known a stay Wikidata leaves open on a site the dataset reads out of danger', () => {
    // The Simien Mountains: on the list from 1996, removed in 2017, while
    // Wikidata's statement states no end.
    const simien = statementsOf([binding({
      item: `${ENTITY}Q504315`, statement: `${ENTITY}statement/Q504315-018a5cf7-44ef-cab6-3f6f-a9b6b49c45d6`,
      start: '1996-01-01T00:00:00Z', startPrecision: '9',
    })], []);
    const next = historyOf({ stays: [], listings: [listing(1978)], listed: true }, siteStatements(simien, ['Q504315']));
    expect(next.stays).toEqual([expect.objectContaining({ from: expect.objectContaining({ year: 1996 }), ended: true, until: null })]);
  });

  it('keeps the dataset\'s open stay over a stay Wikidata ended in the same year', () => {
    const ended = { ...stay(2003), ended: true, until: year(2005) };
    const next = historyOf({ stays: [stay(2003)], listings: [listing(2003)], listed: true }, { stays: [ended], listingEnd: null });
    expect(next.stays).toEqual([stay(2003)]);
  });

  it('keeps two stays of one year apart where their months tell them apart', () => {
    const month = (m: number): SourcedDate => ({ ...year(2004), month: m });
    const winter = { from: month(1), ended: true, until: month(2), ending: null };
    const autumn = { from: month(9), ended: true, until: month(10), ending: null };
    const next = historyOf({ stays: [winter], listings: [listing(1996)], listed: true }, { stays: [autumn], listingEnd: null });
    expect(next.stays).toEqual([winter, autumn]);
  });

  it('keeps the end a stay holds where Wikidata states its start and no end', () => {
    // The Simien Mountains, held from 1996 to 2017, stated from 1996 alone.
    const held = { ...stay(1996), ended: true, until: year(2017) };
    const next = historyOf({ stays: [held], listings: [listing(1978)], listed: true }, { stays: [stay(1996)], listingEnd: null });
    expect(next.stays).toEqual([held]);
  });

  it('leaves a stay a curator decided as it stands, and corrects the run\'s stays around it', () => {
    // A site whose run-held stay of 2004 to 2006 Wikidata now ends in July 2006,
    // beside a stay from 2025 a curator ended, which Wikidata states open.
    const july: SourcedDate = { ...year(2006), month: 7 };
    const run = { ...stay(2004), ended: true, until: year(2006) };
    const curators = stay(2025, true);
    const next = historyOf(
      { stays: [run, curators], others: [false, true], listings: [listing(1996)], listed: true },
      { stays: [{ ...run, until: july }, stay(2025)], listingEnd: null },
    );
    expect(next.stays).toEqual([{ ...run, until: july }, curators]);
  });

  it('ends the current listing of a site struck off, and leaves an earlier one as it is', () => {
    const earlier = { from: year(1990), ended: true, until: year(2000), ending: 'delisted' as const };
    const next = historyOf(
      { stays: [], listings: [earlier, listing(2010)], listed: false }, siteStatements(STATEMENTS, ['Q2021552']),
    );
    expect(next.listings).toEqual([
      earlier,
      { from: year(2010), ended: true, until: expect.objectContaining({ year: 2021, month: 7, day: 21 }), ending: 'delisted' },
    ]);
  });

  it('keeps the stays it holds where Wikidata did not answer', () => {
    const held = [{ ...stay(2004), ended: true, until: year(2006) }];
    expect(historyOf({ stays: held, listings: [listing(1996)], listed: true }, null).stays).toEqual(held);
  });

  it('reopens the listing of a site the list names again', () => {
    const next = historyOf({ stays: [], listings: [{ ...listing(1996), ended: true, ending: 'delisted' }], listed: true }, null);
    expect(next.listings).toEqual([listing(1996)]);
  });
});
