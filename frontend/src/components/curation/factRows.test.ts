/**
 * Tests for a proposal as a table of facts.
 *
 * What is worth pinning is the shape a curator reads: which rows a proposal makes, of
 * what kind, and which fields never make one. The examples are the queue's own — Bamiyan's
 * held card from run 68, the Louvre's from museum run 64.
 */

import { describe, it, expect } from 'vitest';
import { rowsFor, summarize } from './factRows';

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
