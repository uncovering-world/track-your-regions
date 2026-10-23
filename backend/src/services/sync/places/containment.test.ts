/**
 * The containment chain the one resolver reads (#1819): read once, a link
 * nobody could read marked rather than taken for the end of the chain.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../publicArt/queries.js', () => ({ fetchContainerFacts: vi.fn() }));

import { fetchContainerFacts, type ContainerFacts, type EntityFacts } from '../publicArt/queries.js';
import { chainOf, loadContainment, ownersOf, type Containment } from './containment.js';

// The Ecstasy of Saint Teresa is located in the Cornaro chapel, which is in
// and part of Santa Maria della Vittoria.
const CORNARO_CHAPEL = 'Q588885';
const SANTA_MARIA = 'Q863593';
const CHAPEL = 'Q108325';
const CHURCH = 'Q16970';
const UNREAD = 'Q999999999';
// A link up the chain the subset keeps no answer for: the Paleolithic, a period above the Venus
// of Tan-Tan's Acheulean.
const PALEOLITHIC = 'Q40203';

const facts = (over: Partial<EntityFacts>): EntityFacts => ({
  classes: [], locations: [], parents: [], collections: [], creators: [], commemorates: [], depicts: [], genres: [], ...over,
});
const run = { sparql: vi.fn() as never, phase: vi.fn(), step: vi.fn(async () => {}) };

describe('loadContainment', () => {
  it('walks up and marks every id that got no answer', async () => {
    const known: Record<string, ContainerFacts> = {
      [CORNARO_CHAPEL]: { label: 'Cornaro chapel', classes: [CHAPEL], parents: [SANTA_MARIA] },
      [SANTA_MARIA]: { label: 'Santa Maria della Vittoria', classes: [CHURCH], parents: [] },
    };
    vi.mocked(fetchContainerFacts).mockImplementation(async (_sparql, qids) => new Map(
      qids.filter((qid) => known[qid]).map((qid) => [qid, known[qid]]),
    ));

    const containment = await loadContainment(run, [facts({ locations: [CORNARO_CHAPEL], collections: [UNREAD] })]);

    expect([...containment.nodes.keys()]).toEqual([CORNARO_CHAPEL, SANTA_MARIA]);
    expect([...containment.unknown]).toEqual([UNREAD]);
  });
});

describe('loadContainment, a link two candidates reach differently', () => {
  it('marks an unanswered link unknown when a candidate names it itself, whichever hop asked first', async () => {
    // A names CORNARO_CHAPEL; the chapel's parent PALEOLITHIC gets no answer at hop 2.
    // B names PALEOLITHIC as its owner: asked already, never asked again, and still its own link.
    vi.mocked(fetchContainerFacts).mockImplementation(async (_sparql, qids) => new Map(
      qids.filter((qid) => qid === CORNARO_CHAPEL)
        .map((qid) => [qid, { label: 'Cornaro chapel', classes: [CHAPEL], parents: [PALEOLITHIC] }]),
    ));
    const a = facts({ locations: [CORNARO_CHAPEL] });
    const b = facts({ collections: [PALEOLITHIC] });

    const containment = await loadContainment(run, [a, b]);

    expect([...containment.unknown]).toEqual([PALEOLITHIC]);
    // For A it is only above the chapel: no place, and says nothing.
    expect(chainOf(a, containment).find((c) => c.qid === PALEOLITHIC)).toEqual({
      qid: PALEOLITHIC, relation: 'above', via: [CORNARO_CHAPEL], label: PALEOLITHIC, classes: [],
    });
    // For B it is its own owner nobody could read.
    expect(ownersOf(b, containment)[0]).toMatchObject({ qid: PALEOLITHIC, unknown: true });
  });
});

describe('chainOf', () => {
  const containment: Containment = {
    nodes: new Map([
      [CORNARO_CHAPEL, { label: 'Cornaro chapel', classes: [CHAPEL], parents: [SANTA_MARIA, PALEOLITHIC] }],
      [SANTA_MARIA, { label: 'Santa Maria della Vittoria', classes: [CHURCH], parents: [] }],
    ]),
    unknown: new Set([UNREAD]),
  };

  it('lists the chain nearest first, with how each link was reached', () => {
    const chain = chainOf(facts({ locations: [CORNARO_CHAPEL] }), containment);
    expect(chain.map((c) => [c.qid, c.relation, c.via ?? []])).toEqual([
      [CORNARO_CHAPEL, 'located in', []],
      [SANTA_MARIA, 'above', [CORNARO_CHAPEL]],
      [PALEOLITHIC, 'above', [CORNARO_CHAPEL]],
    ]);
  });

  it('lists a link of its own nobody could read as unknown, with no classes to say anything', () => {
    const unread = chainOf(facts({ locations: [UNREAD, CORNARO_CHAPEL] }), containment).find((c) => c.qid === UNREAD);
    expect(unread).toEqual({ qid: UNREAD, relation: 'located in', label: UNREAD, classes: [], unknown: true });
  });

  it('lists a link up the chain that got no answer as saying nothing, since it is no place', () => {
    const above = chainOf(facts({ locations: [CORNARO_CHAPEL] }), containment).find((c) => c.qid === PALEOLITHIC);
    expect(above).toEqual({ qid: PALEOLITHIC, relation: 'above', via: [CORNARO_CHAPEL], label: PALEOLITHIC, classes: [] });
  });

  it('gives an owner no building above it, since ownership is not a place', () => {
    expect(ownersOf(facts({ collections: [CORNARO_CHAPEL] }), containment)[0]).toEqual({
      qid: CORNARO_CHAPEL, relation: 'in the collection of', label: 'Cornaro chapel', classes: [CHAPEL],
    });
  });

  it('reads the owners one level, unread ones marked', () => {
    expect(ownersOf(facts({ collections: [SANTA_MARIA, UNREAD] }), containment).map((c) => [c.qid, c.unknown ?? false])).toEqual([
      [SANTA_MARIA, false], [UNREAD, true],
    ]);
  });
});
