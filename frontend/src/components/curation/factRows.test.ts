/**
 * Tests for a proposal as a table of facts.
 *
 * What is worth pinning is the shape a curator reads: which rows a proposal makes, of
 * what kind, and which fields never make one. The examples are the queue's own — Bamiyan's
 * held card from run 68, the Louvre's from museum run 64.
 */

import { describe, it, expect, vi } from 'vitest';
import { partGroups, rowsFor, summarize } from './factRows';

const NO_CONTEXT = { proposed: [] };

/** Bamiyan's held card from run 68, as the queue carries it. */
const bamiyan = [
  { field: 'tags', old: [], new: ['criterion_i', 'criterion_ii', 'in_danger'], held: true },
  { field: 'metadata.inDanger', old: false, new: true, held: true },
  {
    field: 'metadata',
    old: { website: 'https://whc.unesco.org/en/list/208', region: 'Asia and the Pacific' },
    new: {
      website: 'https://whc.unesco.org/en/list/208', region: 'Asia and the Pacific',
      criteria: '(i)(ii)(iii)(iv)', imageCredit: { author: 'Graciela Gonzalez Brigas', license: '© UNESCO' },
    },
    held: true,
  },
];

describe('rowsFor', () => {
  it('makes one row per fact that moved, named as the fact, in the order the queue gave', () => {
    const rows = rowsFor(bamiyan, NO_CONTEXT);
    expect(rows.map(r => r.meaning.label)).toEqual(['in danger', 'inscription criteria', 'picture credit']);
    // The keys that agree are not rows, and the storage grouping is not a row either.
    expect(rows.map(r => r.id)).toEqual(['metadata.inDanger', 'metadata.criteria', 'metadata.imageCredit']);
  });

  it('keeps tags off the card, even where an older run filed them', () => {
    expect(rowsFor(bamiyan, NO_CONTEXT).some(r => r.field === 'tags')).toBe(false);
  });

  it('says what kind of change each row is', () => {
    const rows = rowsFor(bamiyan, NO_CONTEXT);
    expect(rows.map(r => r.kind)).toEqual(['changed', 'new', 'new']);
    expect(rowsFor([{ field: 'metadata', old: { criteria: '(i)' }, new: {} }], NO_CONTEXT)[0].kind).toBe('removed');
    // An empty list is nothing, to a person.
    expect(rowsFor([{ field: 'countryNames', old: [], new: ['France'] }], NO_CONTEXT)[0].kind).toBe('new');
  });

  it('keeps the rows of one field together and lets them share its answer', () => {
    const rows = rowsFor(bamiyan, NO_CONTEXT);
    expect(rows.filter(r => r.field === 'metadata').map(r => r.id)).toEqual(['metadata.criteria', 'metadata.imageCredit']);
  });

  it('keeps a claimed credit whole, because the vocabulary can say it and its parts have no meaning of their own', () => {
    // `editExperience` claims `metadata.imageCredit` per key, so a run bringing a
    // different credit reports it as its own field with an object on each side.
    const rows = rowsFor([{
      field: 'metadata.imageCredit',
      old: { author: 'Graciela Gonzalez Brigas', license: '© UNESCO' },
      new: { author: 'Someone Else', license: '© UNESCO' },
    }], NO_CONTEXT);
    expect(rows).toHaveLength(1);
    expect(rows[0].meaning.label).toBe('picture credit');
    expect(rows[0].sentence).toBe('A different photographer — check the picture is the one this credit is for.');
  });

  it('keeps a coordinate whole, because a place is not two numbers', () => {
    const rows = rowsFor([{ field: 'location', old: { lon: 4, lat: 49 }, new: { lon: 4, lat: 49.3 } }], NO_CONTEXT);
    expect(rows).toHaveLength(1);
    expect(rows[0].sentence).toBe('Moved 33.4 km north — may fall in a different region; check the pin.');
  });

  it('carries the sentence the fact has about this change, with the object as readers see it', () => {
    const [danger] = rowsFor([bamiyan[1]], { proposed: [], inDanger: true, dangerSince: 2003 });
    expect(danger.sentence).toContain('Readers already see this badge');
  });

  it('carries what a conflict card needs: whether it lands now, and who claimed the field', () => {
    const [row] = rowsFor([{
      field: 'shortDescription', old: 'Six housing estates', new: 'The serial property comprises seven',
      acceptable: true, claim: { by: 'admin', at: '2026-08-04T12:24:20Z' }, decidedBefore: [],
    }], NO_CONTEXT);
    expect(row.acceptable).toBe(true);
    expect(row.provenance?.claim?.by).toBe('admin');
  });
});

describe('summarize', () => {
  it('counts the rows by kind, for the line that says what a run proposes', () => {
    const byKind = summarize(rowsFor(bamiyan, NO_CONTEXT));
    expect(byKind.changed.map(r => r.meaning.label)).toEqual(['in danger']);
    expect(byKind.new.map(r => r.meaning.label)).toEqual(['inscription criteria', 'picture credit']);
    expect(byKind.removed).toEqual([]);
  });
});

describe('partGroups', () => {
  // The Wine Glass under Gemäldegalerie, its attribution held (ADR-0037), and
  // one place of a serial site renamed — as the queue's held card carries them.
  const wineGlass = {
    kind: 'treasures' as const,
    item: { name: 'The Wine Glass', ref: 'Q782639' },
    fields: [{ field: 'artists', old: ['Johannes Vermeer'], new: ['Jan Vermeer van Haarlem the Elder'], held: true }],
    treasureId: 3102, artists: ['Jan Vermeer van Haarlem the Elder'], year: 1659,
    imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/Wine.jpg', imageCredit: null, treasureType: 'painting',
  };
  const montsegur = {
    kind: 'locations' as const,
    item: { name: 'Château de Montésgur', ref: '1755-004' },
    fields: [{ field: 'name', old: 'Château de Montésgur', new: 'Château de Montségur', held: true }],
    locationId: 11134, latitude: 42.8758, longitude: 1.8323, ordinal: 5,
  };

  it('makes one group per part, headed by the name the curator saw', () => {
    const groups = partGroups([montsegur, wineGlass], NO_CONTEXT, { offeredLocations: 8 }, () => {});

    expect(groups.map(g => [g.subject.kind, g.subject.label])).toEqual([
      ['place', 'Château de Montésgur'],
      ['work', 'The Wine Glass'],
    ]);
    expect(groups[0].rows.map(r => r.meaning.label)).toEqual(['name']);
    expect(groups[1].rows.map(r => r.meaning.label)).toEqual(['attribution']);
    expect(groups[1].rows[0].kind).toBe('changed');
  });

  it('tells a part from its siblings: which place of how many, whose work', () => {
    const [place, work] = partGroups([montsegur, wineGlass], NO_CONTEXT, { offeredLocations: 8 }, () => {});

    expect(place.subject.detail).toBe('place 5 of 8');
    // The maker readers see today, since the row is what the change is against.
    expect(work.subject.detail).toBe('by Jan Vermeer van Haarlem the Elder, 1659');
  });

  it('offers a way to open a part only where there is a row to open', () => {
    const onOpen = vi.fn();
    const withdrawn = { ...montsegur, locationId: null, latitude: null, longitude: null, ordinal: null };
    const [gone, work] = partGroups([withdrawn, wineGlass], NO_CONTEXT, { offeredLocations: 8 }, onOpen);

    // The source withdrew the place after proposing its rename: the proposal is
    // still what the run recorded, and there is no pin to look at.
    expect(gone.subject.onOpen).toBeUndefined();
    expect(gone.subject.detail).toBeNull();
    work.subject.onOpen?.();
    expect(onOpen).toHaveBeenCalledWith(wineGlass);
  });

  it('names a part by its reference where the source gave it no name', () => {
    const [group] = partGroups([{ ...montsegur, item: { name: null, ref: '1755-004' } }], NO_CONTEXT, {}, () => {});
    expect(group.subject.label).toBe('1755-004');
  });

  it('tells two parts with one name apart by the reference, so the table can key them', () => {
    // The Getty holds two works called Spring inside its best-known twelve, and a
    // label is a Wikidata string with no uniqueness about it; the reference is the
    // identity the record stores.
    const [first, second] = partGroups([
      { ...wineGlass, item: { name: 'Spring', ref: 'Q1' } },
      { ...wineGlass, item: { name: 'Spring', ref: 'Q2' } },
    ], NO_CONTEXT, {}, () => {});

    expect(first.subject.label).toBe(second.subject.label);
    expect(first.subject.key).toBeDefined();
    expect(first.subject.key).not.toBe(second.subject.key);
  });
});
