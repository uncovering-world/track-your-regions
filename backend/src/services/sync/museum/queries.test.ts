/**
 * What the pool parse makes of an answer that names a work more than once.
 *
 * The query carries five OPTIONALs, so a work with two creators and two images
 * arrives four times, and until #720 the parse kept whichever row came first —
 * which is where the catalogue's one-name-per-work attribution came from.
 * `parsePool` is private, so the questions are asked through `fetchClassPool`,
 * which is the whole of what it does with one answer.
 */

import { describe, it, expect } from 'vitest';
import { fetchClassPool, fetchEntityEdges } from './queries.js';
import type { SparqlFn } from '../wikidataQueries.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const ENTITY = 'http://www.wikidata.org/entity/';

/** One row of the pool answer, with only the columns a case is about. */
function row(
  qid: string, label: string, creator?: { qid?: string; label: string }, img?: string,
): SparqlBinding {
  const binding: SparqlBinding = {
    w: { value: `${ENTITY}${qid}` },
    wLabel: { value: label },
    sl: { value: '30' },
    cls: { value: `${ENTITY}Q3305213` },
    clsLabel: { value: 'painting' },
  };
  if (creator) {
    binding.creatorLabel = { value: creator.label };
    if (creator.qid) binding.creator = { value: `${ENTITY}${creator.qid}` };
  }
  if (img) binding.img = { value: img };
  return binding;
}

function answering(rows: SparqlBinding[]): SparqlFn {
  return async () => rows;
}

describe('the pool parse', () => {
  it('keeps every creator a work names, in the order of the rows it was handed', async () => {
    // The contract is the rows' order and nothing more. It is deliberately *not*
    // the source's order: the banded pool answers in reverse of Wikidata's own
    // (ADR-0040), so what this pins is that the parse adds nothing of its own —
    // no sorting, no reversing — and leaves the ordering question to a curator.
    const pool = await fetchClassPool(answering([
      row('Q2666439', 'Morning in a Pine Forest', { qid: 'Q159905', label: 'Ivan Shishkin' }),
      row('Q2666439', 'Morning in a Pine Forest', { qid: 'Q551563', label: 'Konstantin Savitsky' }),
    ]), ['Q3305213']);

    expect(pool).toHaveLength(1);
    expect(pool[0].creators).toEqual(['Ivan Shishkin', 'Konstantin Savitsky']);
  });

  it('keeps the six of the Moon Museum rather than the first of them', async () => {
    const makers = [
      'Andy Warhol', 'Claes Oldenburg', 'Robert Rauschenberg',
      'John Chamberlain', 'Forrest Myers', 'David Novros',
    ];
    const pool = await fetchClassPool(answering(
      makers.map((label, i) => row('Q3988385', 'Moon Museum', { qid: `Q90000${i}`, label })),
    ), ['Q3305213']);

    expect(pool[0].creators).toEqual(makers);
  });

  it('counts one creator once however many rows carry it', async () => {
    // Two images and two creators is four rows, and the same two people.
    const pool = await fetchClassPool(answering([
      row('Q465762', 'Laocoön', { qid: 'Q311243', label: 'Athanadoros' }, 'a.jpg'),
      row('Q465762', 'Laocoön', { qid: 'Q380704', label: 'Polydoros' }, 'a.jpg'),
      row('Q465762', 'Laocoön', { qid: 'Q311243', label: 'Athanadoros' }, 'b.jpg'),
      row('Q465762', 'Laocoön', { qid: 'Q380704', label: 'Polydoros' }, 'b.jpg'),
    ]), ['Q3305213']);

    expect(pool[0].creators).toEqual(['Athanadoros', 'Polydoros']);
    // The first row still fixes everything single-valued, as it always did.
    expect(pool[0].imageUrl).toBe('a.jpg');
  });

  it('counts one person once when the source names them under two entities', async () => {
    // Q2415079, *The Washington Family*: two `P170` statements, both Edward
    // Savage. Deduping by entity alone would put him on the card twice.
    const pool = await fetchClassPool(answering([
      row('Q2415079', 'The Washington Family', { qid: 'Q1290173', label: 'Edward Savage' }),
      row('Q2415079', 'The Washington Family', { qid: 'Q5343095', label: 'Edward  Savage' }),
    ]), ['Q3305213']);

    expect(pool[0].creators).toEqual(['Edward Savage']);
  });

  it('names nobody where the label service answered with a bare entity id', async () => {
    // The same shape `typeOf` drops for a class: a QID is not a name, and it
    // would read as one on a card.
    const pool = await fetchClassPool(answering([
      row('Q1', 'A work', { qid: 'Q2', label: 'Q2' }),
    ]), ['Q3305213']);

    expect(pool[0].creators).toEqual([]);
  });

  it('leaves a work with no creator with an empty list, not a hole', async () => {
    const pool = await fetchClassPool(answering([row('Q1', 'An anonymous work')]), ['Q3305213']);
    expect(pool[0].creators).toEqual([]);
  });

  it('asks the source for the creator entity, not only its label', async () => {
    // Without `?creator` in the SELECT there is nothing to tell two people with
    // one name apart by, and the dedupe above would be label-only.
    let sent = '';
    await fetchClassPool(async (query) => { sent = query; return []; }, ['Q3305213']);
    expect(sent).toContain('?creator ?creatorLabel');
  });
});

describe('the entity edges', () => {
  it('reads where an entity is located beside what it is part of', async () => {
    // The Egyptian Museum of Berlin is located in (P276) and part of (P361) the Neues Museum,
    // and part of the Staatliche Museen zu Berlin. The door rule needs the location: the Palace
    // Museum is located in the Forbidden City and part of nothing.
    const edges = await fetchEntityEdges(answering([
      { e: { value: `${ENTITY}Q254156` }, cls: { value: `${ENTITY}Q1229164` } },
      { e: { value: `${ENTITY}Q254156` }, parent: { value: `${ENTITY}Q157316` } },
      { e: { value: `${ENTITY}Q254156` }, parent: { value: `${ENTITY}Q700216` } },
      { e: { value: `${ENTITY}Q254156` }, loc: { value: `${ENTITY}Q157316` } },
    ]), ['Q254156']);

    expect(edges.get('Q254156')).toEqual({
      classes: ['Q1229164'], parents: ['Q157316', 'Q700216'], locations: ['Q157316'],
    });
  });

  it('asks the source for the location edge, less any location the entity has left', async () => {
    // A work's P276 carrying an end time (pq:P582) is dropped as a loan that ended or a move
    // already made; an entity's location is read by the same rule, or a collection rehoused
    // from one building to a better-known one next door keeps the old building as its door.
    let sent = '';
    await fetchEntityEdges(async (query) => { sent = query; return []; }, ['Q254156']);
    expect(sent).toContain('wdt:P276 ?loc');
    const locationBranch = sent.slice(sent.indexOf('wdt:P276 ?loc'));
    expect(locationBranch).toMatch(/FILTER NOT EXISTS \{[^}]*ps:P276 \?loc[^}]*pq:P582/);
  });
});
