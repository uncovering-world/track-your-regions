/**
 * The public-art collection as one run of stages against a fake door: classes
 * first, then the pool, then the facts, then the verdict and the fame line.
 *
 * The door answers by the shape of the question, so a test can say what
 * Wikidata holds and read what the catalogue would make of it.
 */

import { describe, it, expect, vi } from 'vitest';

// The street-art entrance's reads of the database (#2035): no copy of English
// Wikipedia's categories unless a test names one, and no held street-art place.
vi.mock('../../dumps/wikipedia/structureTables.js', () => ({ latestStructure: vi.fn(async () => null) }));
vi.mock('../wikipediaStructure.js', () => ({ structureItemsInCategories: vi.fn(async () => []) }));
vi.mock('../admission.js', () => ({ admittedExternalIds: vi.fn(async () => new Set()) }));

import { classifyPublicArt, openArtworkDoor, PUBLIC_ART_KIND, ENTER_SITELINKS, STAY_SITELINKS } from './pipeline.js';
import type { StreetArtReading } from './streetArtPlaces.js';
import { latestStructure } from '../../dumps/wikipedia/structureTables.js';
import { structureItemsInCategories } from '../wikipediaStructure.js';
import { artworkDoorNote, type DoorWork, type ReadershipDoor } from '../readershipDoor.js';
import { gatherPlaces, shareOf } from '../places/gather.js';
import { MONUMENTS_RULE, PUBLIC_ART_RULE, type KindRule } from './kindRules.js';
import { belowLineReason } from '../sourceLine.js';
import type { QueryRunner } from '../wikidataQueries.js';
import type { CacheDescriptor } from '../wikidataCache.js';
import type { SparqlBinding } from '../wikidataUtils.js';
import { isWikipediaEditionsQuery, wikipediaEditionsRows } from '../wikipediaEditionsFixture.js';

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
  /** `P136`: the genres it is filed under. */
  genres?: string[];
}

/** A cast of a group of casts: its item, where it stands, its classes (#880). */
interface CastFixture {
  qid: string;
  label: string;
  coord: string;
  at?: { qid: string; label: string; ended?: boolean };
  country?: string;
  classes: string[];
}

interface World {
  entities: Fixture[];
  /** The casts of each group of casts, by the group's item. */
  casts?: Record<string, CastFixture[]>;
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

/** The casts question: every cast of each group asked about, one row per class (#880). */
function castsOf(world: World, query: string): SparqlBinding[] {
  const asks = new Set(named(query));
  return Object.entries(world.casts ?? {}).filter(([group]) => asks.has(group)).flatMap(([group, casts]) =>
    casts.flatMap((cast) => cast.classes.map((cls) => ({
      g: ref(group), cast: ref(cast.qid), castLabel: { value: cast.label }, coord: { value: cast.coord }, cls: ref(cls),
      ...(cast.at ? { at: ref(cast.at.qid), atLabel: { value: cast.at.label } } : {}),
      ...(cast.at?.ended ? { ended: { value: '2001-01-01T00:00:00Z' } } : {}),
      ...(cast.country ? { countryLabel: { value: cast.country } } : {}),
    }))));
}

/** The groups of casts with no point of their own and a cast that has one, placeless (#880). */
function castGroupsOf(world: World): SparqlBinding[] {
  return world.entities.filter((f) => f.coord === undefined && f.under === '' && (world.casts?.[f.qid]?.length ?? 0) > 0)
    .map((f) => ({ e: ref(f.qid), eLabel: { value: f.label }, sl: { value: String(f.sitelinks) } }));
}

/** A pool question: the broad root it names, the classes its VALUES list, or the entities asked for by id. */
function poolOf(world: World, query: string): SparqlBinding[] {
  if (query.includes('FILTER NOT EXISTS { ?e wdt:P625')) return castGroupsOf(world);
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
    if (isWikipediaEditionsQuery(query)) {
      return Promise.resolve(wikipediaEditionsRows(query, (q) => world.entities.find((e) => e.qid === q)?.sitelinks));
    }
    const tree = query.match(/wdt:P279\* wd:(Q\d+)/);
    if (query.includes('wdt:P279 ?p')) return Promise.resolve(subclassesOf(world, query));
    if (tree) return Promise.resolve(treeOf(world, tree[1]));
    if (query.startsWith('SELECT ?e ?cls')) return Promise.resolve(factsOf(world, query));
    if (query.startsWith('SELECT ?g ?cast')) return Promise.resolve(castsOf(world, query));
    if (query.startsWith('SELECT ?c ?cLabel')) return Promise.resolve(containersOf(world, query));
    if (query.includes('wdt:P136 ?g')) {
      const genres = new Set(named(query));
      return Promise.resolve(world.entities.filter((f) => f.genres?.some((g) => genres.has(g))).map((f) => ({ e: ref(f.qid) })));
    }
    return Promise.resolve(poolOf(world, query));
  };
  return { sparql, phase: () => {}, step: () => Promise.resolve() };
}

const MONUMENT = 'Q4989906';
const SCULPTURE = 'Q860861';
const CATHEDRAL = 'Q56242215';
const BASILICA = 'Q120560';

/** The place gather asked for this kind alone, and the kind's share of it. */
async function gatherPublicArt(run: QueryRunner, admitted: ReadonlySet<string>) {
  return shareOf(await gatherPlaces(run, [{ kind: PUBLIC_ART_KIND, admitted }]), PUBLIC_ART_KIND);
}

/** The run as a pass of one source: the gather, then this source's classification. */
async function collectPublicArt(
  run: QueryRunner, admitted: ReadonlySet<string>, offered?: ReadonlySet<string>, rule: KindRule = PUBLIC_ART_RULE,
) {
  return classifyPublicArt(await gatherPublicArt(run, admitted), rule, admitted, offered);
}

describe('collectPublicArt', () => {
  it('reads a group of casts as one place with a point at every cast, entering through them where it has no point (#880)', async () => {
    const CAST_GROUP = 'Q28890616';
    const GROUP_OF_SCULPTURES = 'Q2293362';
    const world: World = {
      // The casts' class is a sculpture; the group's own says only "group of casts".
      children: { [SCULPTURE]: [GROUP_OF_SCULPTURES] },
      entities: [
        // The Burghers of Calais: a group with a point of its own, named by the class question.
        { qid: 'Q978987', label: 'The Burghers of Calais', under: CAST_GROUP, sitelinks: 30, coord: 'Point(1.8533 50.9524)', classes: [CAST_GROUP] },
        // The Thinker: no point of its own; it enters through its one cast.
        { qid: 'Q18003128', label: 'The Thinker', under: '', sitelinks: 53, classes: [CAST_GROUP] },
      ],
      casts: {
        Q978987: [
          { qid: 'Q29273401', label: 'The Burghers of Calais', coord: 'Point(1.8535 50.9523)', at: { qid: 'Q6454', label: 'Calais' }, country: 'France', classes: [GROUP_OF_SCULPTURES] },
          { qid: 'Q47522991', label: 'The Burghers of Calais, Stanford', coord: 'Point(-122.1699 37.428)', at: { qid: 'Q41506', label: 'Stanford University' }, country: 'United States', classes: [GROUP_OF_SCULPTURES] },
          // A loan that ended is no cast.
          { qid: 'Q900001', label: 'The Burghers of Calais (loan)', coord: 'Point(2.3 48.8)', at: { qid: 'Q19675', label: 'Louvre', ended: true }, classes: [GROUP_OF_SCULPTURES] },
        ],
        Q18003128: [
          { qid: 'Q130544842', label: 'Le Penseur (Kyoto National Museum)', coord: 'Point(135.7723 34.99)', at: { qid: 'Q147286', label: 'Kyoto National Museum' }, country: 'Japan', classes: [SCULPTURE] },
        ],
      },
    };
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set());
    expect(filtered).toEqual([]);
    const burghers = items.find((i) => i.qid === 'Q978987')!;
    expect(burghers.casts).toEqual([
      { name: 'Calais', lat: 50.9523, lon: 1.8535, countryLabel: 'France' },
      { name: 'Stanford University', lat: 37.428, lon: -122.1699, countryLabel: 'United States' },
    ]);
    // The group's own point stays what the verdict read; the casts' class is what admitted it.
    expect([burghers.lat, burghers.lon]).toEqual([50.9524, 1.8533]);
    expect(burghers.classes).toEqual([CAST_GROUP, GROUP_OF_SCULPTURES]);
    const thinker = items.find((i) => i.qid === 'Q18003128')!;
    expect([thinker.lat, thinker.lon]).toEqual([34.99, 135.7723]);
    expect(thinker.countryLabel).toBe('Japan');
    expect(thinker.casts).toEqual([{ name: 'Kyoto National Museum', lat: 34.99, lon: 135.7723, countryLabel: 'Japan' }]);
  });

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
    const monuments = await collectPublicArt(doorTo(world), new Set(), undefined, MONUMENTS_RULE);
    expect(monuments.items.map((i) => i.qid)).toEqual(['Q337179']);
    expect(monuments.items[0]).toMatchObject({ type: 'monument', classes: [MONUMENT], creators: [], artwork: false });
    expect(monuments.fetched).toBe(3);

    const { items, filtered } = await collectPublicArt(doorTo(world), new Set());
    expect(items).toEqual([]);
    expect(filtered).toEqual([
      {
        externalId: 'Q235242', name: 'Pietà', reason: "inside St. Peter's Basilica: a work of a place of worship, not public art",
        heldIn: ['Q12512'],
      },
      { externalId: 'Q337179', name: 'Freedom Monument', reason: 'no public-art class' },
      { externalId: 'Q1499912', name: 'Segovia Cathedral', reason: 'a place of worship, not public art' },
    ]);
  });

  it('classifies one gather for two sources without asking Wikidata again (ADR-0132)', async () => {
    const world: World = {
      entities: [
        { qid: 'Q1', label: 'Stays', under: MONUMENT, sitelinks: STAY_SITELINKS + 1, classes: [MONUMENT] },
        { qid: 'Q3', label: 'Enters', under: MONUMENT, sitelinks: ENTER_SITELINKS, classes: [MONUMENT] },
        { qid: 'Q4', label: 'A statue', under: SCULPTURE, sitelinks: ENTER_SITELINKS, classes: [SCULPTURE] },
        { qid: 'Q5', label: 'Both', under: SCULPTURE, sitelinks: ENTER_SITELINKS, classes: [SCULPTURE, MONUMENT] },
      ],
    };
    let questions = 0;
    const door = doorTo(world);
    const gathered = await gatherPublicArt({ ...door, sparql: (q, d) => { questions++; return door.sparql(q, d); } }, new Set(['Q1']));
    const asked = questions;

    // Each kind decides by its own rule, and each source holds its own stay
    // line: the one that admitted Q1 keeps it.
    const ids = (rule: KindRule, admitted: string[]) =>
      classifyPublicArt(gathered, rule, new Set(admitted)).items.map((i) => i.qid).sort();
    expect(ids(MONUMENTS_RULE, ['Q1'])).toEqual(['Q1', 'Q3', 'Q5']);
    expect(ids(MONUMENTS_RULE, [])).toEqual(['Q3', 'Q5']);
    expect(ids(PUBLIC_ART_RULE, [])).toEqual(['Q4', 'Q5']);
    expect(questions).toBe(asked);
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
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set(['Q1', 'Q4']), undefined, MONUMENTS_RULE);

    expect(items.map((i) => i.qid).sort()).toEqual(['Q1', 'Q3']);
    // An admitted row that fell below the stay line is refused by name, with
    // its number; one that was never in is not a refusal and nothing is said.
    expect(filtered).toEqual([{
      externalId: 'Q4', name: 'Fountain of Cybele',
      reason: `${STAY_SITELINKS - 1} Wikipedia editions: below the world tier's line (${ENTER_SITELINKS} to enter, ${STAY_SITELINKS} to stay)`,
      // A row the source admits carries the type its classes read, for a
      // curator's put-back to be filed under (ADR-0135).
      type: 'monument',
    }]);
    // And it is the catalogue's one sentence for that verdict, not a copy of it
    // that happens to read the same (#884): this kind asks `lineStanding` and
    // `belowLineReason` like every other, its line stated in code rather than on
    // its row being the only difference.
    expect(filtered[0].reason).toBe(
      belowLineReason(STAY_SITELINKS - 1, {
        enterSitelinks: ENTER_SITELINKS, staySitelinks: STAY_SITELINKS,
      }),
    );
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
      {
        externalId: 'Q3100139', name: 'Dendera zodiac', reason: 'inside Room 325 (Louvre Palace): a work indoors, not public art',
        // The room, and every place the walk reached above it, nearest first (ADR-0102).
        heldIn: ['Q19119449', 'Q7', 'Q17309954', 'Q1075988'],
        type: 'sculpture',
      },
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
      {
        externalId: 'Q9', name: 'A bust', reason: 'inside Room 12 (Palazzo Barberini): a work indoors, not public art',
        heldIn: ['Q1', 'Q2', 'Q220'],
      },
    ]);
  });

  it('hands the rule how each container was reached, so a museum a monument is part of owns it', async () => {
    // The Pakistan Monument: located in Shakarparian, a park; part of the
    // Pakistan Monument Museum, which stands in the monument's base and says
    // so — part of the monument, located in the park. The walk reaches the
    // park again and the monument itself above the museum; the rule reads
    // the museum as the monument's owner and what stands above it as the
    // museum's, and the park as where the monument stands (#803). A
    // sculpture that is only part of a museum has nowhere else to stand, and
    // is the museum's.
    const world: World = {
      museumTree: ['Q33506'],
      containers: {
        Q7462557: { label: 'Shakarparian', classes: ['Q22698'] },
        Q86452047: { label: 'Pakistan Monument Museum', classes: ['Q33506'], parents: ['Q7462557', 'Q3695640'] },
        Q3695640: { label: 'Pakistan Monument', classes: [MONUMENT] },
      },
      entities: [
        { qid: 'Q3695640', label: 'Pakistan Monument', under: MONUMENT, sitelinks: 25, classes: [MONUMENT],
          locations: ['Q7462557'], parents: ['Q86452047'] },
        { qid: 'Q8', label: 'A bust', under: SCULPTURE, sitelinks: 30, classes: [SCULPTURE], parents: ['Q86452047'] },
      ],
    };
    const monuments = await collectPublicArt(doorTo(world), new Set(), undefined, MONUMENTS_RULE);
    expect(monuments.items.map((i) => i.qid)).toEqual(['Q3695640']);
    const { filtered } = await collectPublicArt(doorTo(world), new Set());
    expect(filtered.filter((f) => f.externalId === 'Q8')).toEqual([{
      externalId: 'Q8', name: 'A bust',
      reason: 'part of Pakistan Monument Museum: a work of a museum, not public art',
      heldIn: ['Q86452047'],
    }]);
  });

  it('records a walk that arrives at a museum the work is part of, so the courtyard places it there', async () => {
    // A work part of a museum and located in its courtyard, which is part of
    // the museum. The museum is named by the work's own statement and reached
    // again from the courtyard; the second route is what makes it a place.
    const world: World = {
      museumTree: ['Q33506'],
      containers: {
        Q4: { label: 'A courtyard', classes: ['Q1178342'], parents: ['Q2'] },
        Q2: { label: 'A museum', classes: ['Q33506'] },
      },
      entities: [
        { qid: 'Q9', label: 'A bust', under: SCULPTURE, sitelinks: 30, classes: [SCULPTURE],
          locations: ['Q4'], parents: ['Q2'] },
      ],
    };
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set());
    expect(items).toEqual([]);
    expect(filtered).toEqual([
      { externalId: 'Q9', name: 'A bust', reason: 'inside A museum: a work of a museum, not public art', heldIn: ['Q2'] },
    ]);
  });

  it('records every route to a container, so the order of two part-of statements decides nothing', async () => {
    // A work part of a site museum and of a courtyard, both part of one
    // museum complex. Walked museum-first, the complex is reached through the
    // institution first and listed once; the courtyard's route must still be
    // recorded, or the complex would go with the museum and the veto with it.
    const complex = (parents: string[]): World => ({
      museumTree: ['Q33506'],
      containers: {
        Q2: { label: 'A site museum', classes: ['Q33506'], parents: ['Q3'] },
        Q4: { label: 'A courtyard', classes: ['Q1178342'], parents: ['Q3'] },
        Q3: { label: 'A museum complex', classes: ['Q33506'] },
      },
      entities: [
        { qid: 'Q9', label: 'A bust', under: SCULPTURE, sitelinks: 30, classes: [SCULPTURE], parents },
      ],
    });
    for (const parents of [['Q2', 'Q4'], ['Q4', 'Q2']]) {
      const { items, filtered } = await collectPublicArt(doorTo(complex(parents)), new Set());
      expect(items, parents.join(',')).toEqual([]);
      expect(filtered, parents.join(',')).toEqual([
        {
          externalId: 'Q9', name: 'A bust', reason: 'inside A museum complex: a work of a museum, not public art',
          heldIn: ['Q3'],
        },
      ]);
    }
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
      heldIn: ['Q4410161'],
    }]);
  });

  it('refuses an admitted row whose coordinate Wikidata removed, by name', async () => {
    const world: World = {
      entities: [
        { qid: 'Q8', label: 'A lost pin', under: 'nobody', sitelinks: 40, classes: [MONUMENT], coord: '' },
      ],
    };
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set(['Q8']), undefined, MONUMENTS_RULE);
    expect(items).toEqual([]);
    expect(filtered).toEqual([{ externalId: 'Q8', name: 'A lost pin', reason: 'no coordinates of its own (P625)', type: 'monument' }]);
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
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set(['Q2736564']), undefined, MONUMENTS_RULE);
    expect(items).toEqual([]);
    expect(filtered).toEqual([{
      externalId: 'Q2736564', name: 'Fountain of Cybele',
      reason: `14 Wikipedia editions: below the world tier's line (${ENTER_SITELINKS} to enter, ${STAY_SITELINKS} to stay)`,
      type: 'monument',
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

describe('the readership door (#2033)', () => {
  const KELPIES = 'Q16988858';
  const MAMAN = 'Q180887';
  const doorFor = (opened: Record<string, number>): ReadershipDoor => ({
    opened: new Map(Object.entries(opened).map(([qid, views]) => [qid, { views, burst: false }])),
    bar: 115_121,
    exit: 76_328,
  });
  const collectThrough = async (world: World, admitted: Set<string>, door: ReadershipDoor) =>
    classifyPublicArt(await gatherPublicArt(doorTo(world), admitted), PUBLIC_ART_RULE, admitted, undefined, door);

  it('admits a work below the line the door opened for, with the curator\'s question on it', async () => {
    const world: World = {
      entities: [
        { qid: KELPIES, label: 'The Kelpies', under: SCULPTURE, sitelinks: 17, classes: [SCULPTURE] },
        { qid: MAMAN, label: 'Maman', under: SCULPTURE, sitelinks: 20, classes: [SCULPTURE] },
        { qid: 'Q3', label: 'A statue nobody reads', under: SCULPTURE, sitelinks: 17, classes: [SCULPTURE] },
      ],
    };
    const door = doorFor({ [KELPIES]: 193_801, [MAMAN]: 215_384 });
    const { items, filtered } = await collectThrough(world, new Set(), door);

    expect(items.map((i) => [i.qid, i.readershipNote])).toEqual([
      [MAMAN, artworkDoorNote({ views: 215_384, burst: false }, door)],
      [KELPIES, artworkDoorNote({ views: 193_801, burst: false }, door)],
    ]);
    // A work the door did not open for is below the line and never in: no refusal is said.
    expect(filtered).toEqual([]);
  });

  it('still refuses by its rule a work the door opened for', async () => {
    const world: World = {
      worshipTree: [BASILICA],
      containers: { Q12512: { label: "St. Peter's Basilica", classes: [BASILICA] } },
      entities: [
        { qid: 'Q7', label: 'A statue in the basilica', under: SCULPTURE, sitelinks: 19, classes: [SCULPTURE], locations: ['Q12512'] },
      ],
    };
    const { items, filtered } = await collectThrough(world, new Set(), doorFor({ Q7: 300_000 }));

    expect(items).toEqual([]);
    expect(filtered).toEqual([{
      externalId: 'Q7', name: 'A statue in the basilica',
      reason: "inside St. Peter's Basilica: a work of a place of worship, not public art", heldIn: ['Q12512'],
    }]);
  });

  it('asks nothing of a work the line keeps, and keeps a held work below the stay line the door holds', async () => {
    const world: World = {
      entities: [
        { qid: 'Q1', label: 'Held on the stay line', under: SCULPTURE, sitelinks: STAY_SITELINKS, classes: [SCULPTURE] },
        { qid: 'Q2', label: 'Held, fallen below it', under: SCULPTURE, sitelinks: STAY_SITELINKS - 2, classes: [SCULPTURE] },
      ],
    };
    const door = doorFor({ Q1: 200_000, Q2: 80_000 });
    const { items, filtered } = await collectThrough(world, new Set(['Q1', 'Q2']), door);

    expect(items.map((i) => [i.qid, i.readershipNote])).toEqual([
      ['Q1', undefined],
      ['Q2', artworkDoorNote({ views: 80_000, burst: false }, door)],
    ]);
    expect(filtered).toEqual([]);
  });

  it('hands the door every work below the line and the held ones the rule still passes, so the bar is read over what the source holds', async () => {
    const world: World = {
      worshipTree: [BASILICA],
      containers: { Q12512: { label: "St. Peter's Basilica", classes: [BASILICA] } },
      entities: [
        { qid: 'Q1', label: 'Held at the line', under: SCULPTURE, sitelinks: ENTER_SITELINKS + 10, classes: [SCULPTURE] },
        // Held, but now inside a church: the rule refuses it, so it sets no bar.
        { qid: 'Q4', label: 'Held, now in the basilica', under: SCULPTURE, sitelinks: ENTER_SITELINKS + 30, classes: [SCULPTURE], locations: ['Q12512'] },
        { qid: 'Q2', label: 'Over the line, not held', under: SCULPTURE, sitelinks: ENTER_SITELINKS + 20, classes: [SCULPTURE] },
        { qid: KELPIES, label: 'The Kelpies', under: SCULPTURE, sitelinks: 17, classes: [SCULPTURE] },
      ],
    };
    const admitted = new Set(['Q1', 'Q4']);
    const gathered = await gatherPublicArt(doorTo(world), admitted);
    const asked: Array<{ places: DoorWork[]; held: ReadonlySet<string> }> = [];
    const opened = await openArtworkDoor((places, held) => {
      asked.push({ places, held });
      return Promise.resolve(doorFor({}));
    }, gathered, admitted, PUBLIC_ART_RULE);

    expect(opened).not.toBeNull();
    expect(asked[0].places.map((p) => p.qid).sort()).toEqual(['Q1', KELPIES]);
    expect(asked[0].held).toBe(admitted);
    // No door while the source's gate is off: the run admits by its line alone.
    expect(await openArtworkDoor(undefined, gathered, admitted, PUBLIC_ART_RULE)).toBeNull();
  });
});

describe('the street-art places (#2035)', () => {
  const WALL = 'Q42948';
  const ROAD = 'Q34442';
  const STREET_ART = 'Q17516';
  const LENNON_WALL = 'Q1630131';
  const HOSIER_LANE = 'Q5908090';
  const world: World = {
    worshipTree: [CATHEDRAL],
    entities: [
      // Filed under a graffiti category, typed a wall: no class of the kind names it.
      { qid: LENNON_WALL, label: 'Lennon Wall', under: '', sitelinks: 25, coord: 'Point(14.4067 50.0864)', classes: [WALL] },
      // Filed under the genre street art, typed a road.
      { qid: HOSIER_LANE, label: 'Hosier Lane', under: '', sitelinks: 4, coord: 'Point(144.9691 -37.8166)', classes: [ROAD], genres: [STREET_ART] },
      // A cathedral a category files for its graffiti.
      { qid: 'Q9', label: 'A painted cathedral', under: '', sitelinks: 30, classes: [CATHEDRAL] },
      // A sculpture a category files too: the kind's own.
      { qid: 'Q8', label: 'A sculpture with a tag on it', under: SCULPTURE, sitelinks: ENTER_SITELINKS, classes: [SCULPTURE] },
      // A monument the kind's classes name, filed under a category, with no mark.
      { qid: 'Q7', label: 'A sprayed monument', under: MONUMENT, sitelinks: 5, classes: [MONUMENT] },
      // Named by the category alone, with one mark.
      { qid: 'Q6', label: 'A local underpass', under: '', sitelinks: 2, classes: [WALL] },
    ],
  };
  const reading = (over: Partial<StreetArtReading> = {}): StreetArtReading => ({
    marks: new Map([
      [LENNON_WALL, { atlasObscura: true, ended: false }],
      [HOSIER_LANE, { atlasObscura: true, ended: false }],
      ['Q9', { atlasObscura: true, ended: false }],
      ['Q6', { atlasObscura: true, ended: false }],
    ]),
    guided: new Set([LENNON_WALL, 'Q9']),
    readers: new Map([[LENNON_WALL, 120_000], [HOSIER_LANE, 40_000], ['Q9', 50_000], ['Q6', 900]]),
    roots: new Map(),
    ...over,
  });
  const withCopy = () => {
    vi.mocked(latestStructure).mockResolvedValueOnce({ dumpDate: '2026-10-01', swappedAt: new Date(), needs: {} as never });
    vi.mocked(structureItemsInCategories).mockResolvedValueOnce([LENNON_WALL, 'Q9', 'Q8', 'Q7', 'Q6']);
  };

  it('brings in what a category or the genre files, and tells apart what only the entrance named', async () => {
    withCopy();
    const gathered = await gatherPublicArt(doorTo(world), new Set());
    expect([...gathered.entered].sort()).toEqual([HOSIER_LANE, LENNON_WALL, 'Q6', 'Q7', 'Q8', 'Q9'].sort());
    expect([...gathered.enteredOnly].sort()).toEqual([HOSIER_LANE, LENNON_WALL, 'Q6', 'Q9'].sort());
  });

  it('admits a street-art place by its marks, refuses another kind\'s place by name, and leaves the tail unsaid', async () => {
    withCopy();
    const gathered = await gatherPublicArt(doorTo(world), new Set());
    const { items, filtered } = classifyPublicArt(gathered, PUBLIC_ART_RULE, new Set(), undefined, null, reading());

    expect(items.map((i) => [i.qid, i.type, i.artwork])).toEqual([
      [LENNON_WALL, 'street-art', true],
      ['Q8', 'sculpture', true],
      [HOSIER_LANE, 'street-art', true],
    ]);
    expect(filtered).toEqual([
      { externalId: 'Q9', name: 'A painted cathedral', reason: 'a place of worship: not a street-art place' },
      // Named by a class of the kind too: it keeps the kind's reason.
      { externalId: 'Q7', name: 'A sprayed monument', reason: 'no public-art class' },
    ]);
  });

  it('keeps a held street-art place on one mark, and refuses it by the line below that', async () => {
    withCopy();
    const held = new Set([LENNON_WALL]);
    const gathered = await gatherPublicArt(doorTo(world), held);
    const kept = classifyPublicArt(gathered, PUBLIC_ART_RULE, held, undefined, null, reading({ guided: new Set() }));
    expect(kept.items.map((i) => i.qid)).toContain(LENNON_WALL);

    const fell = classifyPublicArt(gathered, PUBLIC_ART_RULE, held, undefined, null, reading({
      marks: new Map(), guided: new Set(), readers: new Map([[LENNON_WALL, 3_000]]),
    }));
    expect(fell.items.map((i) => i.qid)).not.toContain(LENNON_WALL);
    expect(fell.filtered).toContainEqual(expect.objectContaining({
      externalId: LENNON_WALL, type: 'street-art', reason: expect.stringContaining('below the street-art line'),
    }));
  });

  it('is not Monuments & memorials\' to decide: what only the entrance named is skipped there', async () => {
    withCopy();
    const gathered = await gatherPublicArt(doorTo(world), new Set());
    const { items, filtered } = classifyPublicArt(gathered, MONUMENTS_RULE, new Set());
    const ids = [...items, ...filtered].map((row) => 'qid' in row ? row.qid : row.externalId);
    expect(ids).not.toContain(LENNON_WALL);
    expect(ids).not.toContain(HOSIER_LANE);
    expect(ids).not.toContain('Q9');
  });

  it('reads the genre alone when no copy of the categories is built', async () => {
    const gathered = await gatherPublicArt(doorTo(world), new Set());
    expect([...gathered.entered]).toEqual([HOSIER_LANE]);
  });
});
