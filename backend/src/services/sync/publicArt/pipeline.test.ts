/**
 * The public-art collection as one run of stages against a fake door: classes
 * first, then the pool, then the facts, then the verdict and the fame line.
 *
 * The door answers by the shape of the question, so a test can say what
 * Wikidata holds and read what the catalogue would make of it.
 */

import { describe, it, expect } from 'vitest';
import { collectPublicArt, ENTER_SITELINKS, STAY_SITELINKS } from './pipeline.js';
import type { QueryRunner } from '../wikidataQueries.js';
import type { CacheDescriptor } from '../wikidataCache.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const ENTITY = 'http://www.wikidata.org/entity/';
const ref = (qid: string) => ({ value: `${ENTITY}${qid}` });

interface Fixture {
  qid: string;
  label: string;
  /** Which query offers it: a broad root, or a narrow class — or nobody, for a row only its id reaches. */
  under: string;
  sitelinks: number;
  coord?: string;
  classes: string[];
  locations?: string[];
  parents?: string[];
  /** `P195`: whose collection it is in. */
  collections?: string[];
  creators?: string[];
}

interface World {
  entities: Fixture[];
  /** Direct subclasses per parent, for the bounded closure. */
  children?: Record<string, string[]>;
  museumTree?: string[];
  worshipTree?: string[];
  containers?: Record<string, { label: string; classes: string[]; parents?: string[] }>;
}

const named = (query: string): string[] => [...query.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);

const subclassesOf = (world: World, query: string): SparqlBinding[] =>
  named(query).flatMap((p) => (world.children?.[p] ?? []).map((c) => ({ c: ref(c) })));

const treeOf = (world: World, root: string): SparqlBinding[] =>
  ((root === 'Q33506' ? world.museumTree : world.worshipTree) ?? []).map((c) => ({ c: ref(c) }));

function factsOf(world: World, query: string): SparqlBinding[] {
  const qids = new Set(named(query));
  return world.entities.filter((f) => qids.has(f.qid)).flatMap((f) => [
    ...f.classes.map((c) => ({ e: ref(f.qid), cls: ref(c) })),
    ...(f.locations ?? []).map((l) => ({ e: ref(f.qid), loc: ref(l) })),
    ...(f.parents ?? []).map((p) => ({ e: ref(f.qid), parent: ref(p) })),
    ...(f.collections ?? []).map((c) => ({ e: ref(f.qid), coll: ref(c) })),
    ...(f.creators ?? []).map((name) => ({ e: ref(f.qid), creator: ref('Q0'), creatorLabel: { value: name } })),
  ]);
}

const containersOf = (world: World, query: string): SparqlBinding[] =>
  named(query).flatMap((q) => {
    const container = world.containers?.[q];
    if (!container) return [];
    return [
      ...container.classes.map((c) => ({ c: ref(q), cLabel: { value: container.label }, cls: ref(c) })),
      ...(container.parents ?? []).map((p) => ({ c: ref(q), cLabel: { value: container.label }, up: ref(p) })),
    ];
  });

/** A pool question: the broad root it names, the classes its VALUES list, or the entities asked for by id. */
function poolOf(world: World, query: string): SparqlBinding[] {
  const asks = new Set(named(query));
  const byId = query.includes('VALUES ?e');
  return world.entities.filter((f) => (byId ? asks.has(f.qid) : asks.has(f.under))).map((f) => ({
    e: ref(f.qid), eLabel: { value: f.label }, sl: { value: String(f.sitelinks) },
    coord: { value: f.coord ?? 'Point(12.5 41.9)' },
  }));
}

/** A door that answers from the world above, recording what each question was filed under. */
function doorTo(world: World, asked: CacheDescriptor['kind'][] = []): QueryRunner {
  const sparql = (sent: string, descriptor?: CacheDescriptor): Promise<SparqlBinding[]> => {
    if (descriptor) asked.push(descriptor.kind);
    const query = sent.trimStart();
    const tree = query.match(/wdt:P279\* wd:(Q\d+)/);
    if (query.includes('wdt:P279 ?p')) return Promise.resolve(subclassesOf(world, query));
    if (tree) return Promise.resolve(treeOf(world, tree[1]));
    if (query.startsWith('SELECT ?e ?cls')) return Promise.resolve(factsOf(world, query));
    if (query.startsWith('SELECT ?c ?cLabel')) return Promise.resolve(containersOf(world, query));
    return Promise.resolve(poolOf(world, query));
  };
  return { sparql, phase: () => {}, step: () => Promise.resolve() };
}

const MONUMENT = 'Q4989906';
const SCULPTURE = 'Q860861';
const CATHEDRAL = 'Q56242215';
const BASILICA = 'Q120560';

describe('collectPublicArt', () => {
  it('admits what clears the line and files what the rule refuses, with its reason', async () => {
    const world: World = {
      worshipTree: ['Q1370598', CATHEDRAL, BASILICA],
      containers: { Q12512: { label: "St. Peter's Basilica", classes: [BASILICA] } },
      entities: [
        { qid: 'Q337179', label: 'Freedom Monument', under: MONUMENT, sitelinks: 41, classes: [MONUMENT] },
        { qid: 'Q1499912', label: 'Segovia Cathedral', under: MONUMENT, sitelinks: 31, classes: [CATHEDRAL, MONUMENT] },
        { qid: 'Q235242', label: 'Pietà', under: SCULPTURE, sitelinks: 56, classes: [SCULPTURE],
          locations: ['Q12512'], creators: ['Michelangelo'] },
      ],
    };
    const { items, filtered, fetched } = await collectPublicArt(doorTo(world), new Set());

    expect(items.map((i) => i.qid)).toEqual(['Q337179']);
    expect(items[0]).toMatchObject({ type: 'monument', classes: [MONUMENT], creators: [], artwork: false });
    expect(fetched).toBe(3);
    expect(filtered).toEqual([
      { externalId: 'Q235242', name: 'Pietà', reason: "inside St. Peter's Basilica: a work of a place of worship, not public art" },
      { externalId: 'Q1499912', name: 'Segovia Cathedral', reason: 'a place of worship, not public art' },
    ]);
  });

  it('keeps an admitted row that slipped below the entry line but not below the stay line', async () => {
    const world: World = {
      entities: [
        { qid: 'Q1', label: 'Stays', under: MONUMENT, sitelinks: STAY_SITELINKS + 1, classes: [MONUMENT] },
        { qid: 'Q2', label: 'Not yet', under: MONUMENT, sitelinks: ENTER_SITELINKS - 1, classes: [MONUMENT] },
        { qid: 'Q3', label: 'Enters', under: MONUMENT, sitelinks: ENTER_SITELINKS, classes: [MONUMENT] },
        { qid: 'Q4', label: 'Fountain of Cybele', under: MONUMENT, sitelinks: STAY_SITELINKS - 1, classes: [MONUMENT] },
        { qid: 'Q5', label: 'Never in', under: MONUMENT, sitelinks: STAY_SITELINKS - 1, classes: [MONUMENT] },
      ],
    };
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set(['Q1', 'Q4']));

    expect(items.map((i) => i.qid).sort()).toEqual(['Q1', 'Q3']);
    // An admitted row that fell below the stay line is refused by name, with
    // its number; one that was never in is not a refusal and nothing is said.
    expect(filtered).toEqual([{
      externalId: 'Q4', name: 'Fountain of Cybele',
      reason: `${STAY_SITELINKS - 1} sitelinks: below the world tier's line (${ENTER_SITELINKS} to enter, ${STAY_SITELINKS} to stay)`,
    }]);
  });

  it('walks a work up from its room to the building that holds it', async () => {
    // The Dendera zodiac is located in Room 325, which is in the Sully Wing,
    // which is part of the Louvre Palace: three hops, and the palace is what
    // names the building in the reason — not the tomb the work is also part
    // of, which the walk visits last, and not the city above the palace, which
    // it never fetched.
    const world: World = {
      containers: {
        Q19119449: { label: 'Room 325', classes: ['Q180516'], parents: ['Q17309954'] },
        Q17309954: { label: 'Sully Wing', classes: ['Q1125776'], parents: ['Q1075988'] },
        Q1075988: { label: 'Louvre Palace', classes: ['Q16560'], parents: ['Q90'] },
        Q90: { label: 'Paris', classes: ['Q515'] },
        Q7: { label: 'Tomb of somebody', classes: ['Q381885'] },
      },
      entities: [
        { qid: 'Q3100139', label: 'Dendera zodiac', under: SCULPTURE, sitelinks: 19, classes: [SCULPTURE],
          locations: ['Q19119449'], parents: ['Q7'] },
      ],
    };
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set(['Q3100139']));
    expect(items).toEqual([]);
    expect(filtered).toEqual([
      { externalId: 'Q3100139', name: 'Dendera zodiac', reason: 'inside Room 325 (Louvre Palace): a work indoors, not public art' },
    ]);
  });

  it('names the building above a room, not the city above the building', async () => {
    // A room directly inside a palace: the walk fetches the palace's city at
    // the third hop, and the reason must still name the palace — the first
    // thing above the room that is not itself a room or a wing.
    const world: World = {
      containers: {
        Q1: { label: 'Room 12', classes: ['Q180516'], parents: ['Q2'] },
        Q2: { label: 'Palazzo Barberini', classes: ['Q16560'], parents: ['Q220'] },
        Q220: { label: 'Rome', classes: ['Q515'] },
      },
      entities: [
        { qid: 'Q9', label: 'A bust', under: SCULPTURE, sitelinks: 30, classes: [SCULPTURE], locations: ['Q1'] },
      ],
    };
    const { filtered } = await collectPublicArt(doorTo(world), new Set());
    expect(filtered).toEqual([
      { externalId: 'Q9', name: 'A bust', reason: 'inside Room 12 (Palazzo Barberini): a work indoors, not public art' },
    ]);
  });

  it('reads whose collection a work is in only when nothing says where it stands', async () => {
    // The Shigir Idol: no location, no part-of; in the collection of the
    // Sverdlovsk Regional Natural History Museum — the first live run admitted
    // it as a monument on the museum (#804). The Sibelius Monument: located in
    // Sibelius Park, in the collection of HAM Helsinki Art Museum, which owns
    // the city's outdoor sculpture — the park is where it stands, and the
    // museum is not asked about.
    const world: World = {
      museumTree: ['Q33506', 'Q1970365', 'Q207694'],
      containers: {
        Q4410161: { label: 'Sverdlovsk Regional Natural History Museum', classes: ['Q1970365'] },
        Q3481120: { label: 'Sibelius Park', classes: ['Q22698'] },
        Q5710459: { label: 'HAM Helsinki Art Museum', classes: ['Q207694'] },
      },
      entities: [
        { qid: 'Q4523656', label: 'Shigir Idol', under: SCULPTURE, sitelinks: 33, classes: [SCULPTURE],
          collections: ['Q4410161'] },
        { qid: 'Q2584017', label: 'Sibelius Monument', under: SCULPTURE, sitelinks: 22, classes: [SCULPTURE],
          locations: ['Q3481120'], collections: ['Q5710459'] },
      ],
    };
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set());
    expect(items.map((i) => i.qid)).toEqual(['Q2584017']);
    expect(filtered).toEqual([{
      externalId: 'Q4523656', name: 'Shigir Idol',
      reason: 'in the collection of Sverdlovsk Regional Natural History Museum: a work of a museum, not public art',
    }]);
  });

  it('refuses an admitted row whose coordinate Wikidata removed, by name', async () => {
    const world: World = {
      entities: [
        { qid: 'Q8', label: 'A lost pin', under: 'nobody', sitelinks: 40, classes: [MONUMENT], coord: '' },
      ],
    };
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set(['Q8']));
    expect(items).toEqual([]);
    expect(filtered).toEqual([{ externalId: 'Q8', name: 'A lost pin', reason: 'no coordinates of its own (P625)' }]);
  });

  it('fetches an admitted row the pool no longer names, so its refusal is named too', async () => {
    // An admitted row at 14 sitelinks is below the pool floor and no class
    // question returns it; asked for by id, it is refused with its number
    // rather than swept with the generic reason.
    const world: World = {
      entities: [
        { qid: 'Q2736564', label: 'Fountain of Cybele', under: 'nobody', sitelinks: 14, classes: [MONUMENT] },
      ],
    };
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set(['Q2736564']));
    expect(items).toEqual([]);
    expect(filtered).toEqual([{
      externalId: 'Q2736564', name: 'Fountain of Cybele',
      reason: `14 sitelinks: below the world tier's line (${ENTER_SITELINKS} to enter, ${STAY_SITELINKS} to stay)`,
    }]);
  });

  it('makes one entity of a row two questions both offer', async () => {
    const world: World = {
      children: { [SCULPTURE]: ['Q1779653'] },
      entities: [
        { qid: 'Q79961', label: 'Christ the Redeemer', under: SCULPTURE, sitelinks: 94, classes: [SCULPTURE, 'Q1779653'] },
        { qid: 'Q79961', label: 'Christ the Redeemer', under: 'Q1779653', sitelinks: 94, classes: [SCULPTURE, 'Q1779653'] },
      ],
    };
    const { items, fetched } = await collectPublicArt(doorTo(world), new Set());

    expect(fetched).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ qid: 'Q79961', type: 'sculpture' });
  });

  it('types a row from the sculptural closure and carries its makers', async () => {
    const world: World = {
      children: { [SCULPTURE]: ['Q1779653'] },
      entities: [
        { qid: 'Q1601986', label: 'The Motherland Calls', under: 'Q1779653', sitelinks: 54,
          classes: ['Q1779653', MONUMENT, 'Q179700'], creators: ['Yevgeny Vuchetich', 'Nikolai Nikitin'] },
      ],
    };
    const { items } = await collectPublicArt(doorTo(world), new Set());
    expect(items[0]).toMatchObject({
      type: 'sculpture', creators: ['Yevgeny Vuchetich', 'Nikolai Nikitin'],
      classes: ['Q1779653', MONUMENT, 'Q179700'],
      // The rule's own answer to "did an artwork class answer", carried for the check.
      artwork: true,
    });
  });

  it('steps the runner before every question, the class-tree hops included', async () => {
    // The step is where the pacing is spent and a cancel is heard; a closure
    // hop is one query like any other and must not go out back to back.
    const world: World = {
      children: { [SCULPTURE]: ['Q1779653'], Q1779653: ['Q29168169'] },
      entities: [{ qid: 'Q2', label: 'x', under: MONUMENT, sitelinks: 30, classes: [MONUMENT] }],
    };
    let questions = 0;
    let steps = 0;
    const door = doorTo(world);
    const runner: QueryRunner = {
      sparql: (q, d) => { questions++; return door.sparql(q, d); },
      phase: () => {},
      step: () => { steps++; return Promise.resolve(); },
    };
    await collectPublicArt(runner, new Set());
    expect(steps).toBeGreaterThanOrEqual(questions);
  });

  it('files each stage under its own cache kind', async () => {
    const asked: CacheDescriptor['kind'][] = [];
    const world: World = {
      containers: { Q1: { label: 'Somewhere', classes: ['Q174782'] } },
      entities: [{ qid: 'Q2', label: 'x', under: MONUMENT, sitelinks: 30, classes: [MONUMENT], locations: ['Q1'] }],
    };
    await collectPublicArt(doorTo(world, asked), new Set());
    expect(new Set(asked)).toEqual(new Set(['classes', 'pool', 'edges', 'entities']));
    // Every question is filed: a query with no descriptor is one the cache never keeps.
    expect(asked.length).toBeGreaterThan(0);
  });
});
