/**
 * The fake Wikidata of the public-art pipeline specs: a world of entities,
 * classes, casts and containers, and a door that answers each question of the
 * gather by the shape of the query, so a spec can say what Wikidata holds and
 * read what the catalogue would make of it. Shared by `pipeline.test.ts` and
 * `pipeline.marksDoor.test.ts`; each spec declares its own module mocks.
 */

import { classifyPublicArt, PUBLIC_ART_KIND } from './pipeline.js';
import { gatherPlaces, shareOf } from '../places/gather.js';
import { PUBLIC_ART_RULE, type KindRule } from './kindRules.js';
import type { QueryRunner } from '../wikidataQueries.js';
import type { CacheDescriptor } from '../wikidataCache.js';
import type { SparqlBinding } from '../wikidataUtils.js';
import { isWikipediaEditionsQuery, wikipediaEditionsRows } from '../wikipediaEditionsFixture.js';

const ENTITY = 'http://www.wikidata.org/entity/';
const ref = (qid: string) => ({ value: `${ENTITY}${qid}` });

export interface Fixture {
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
export interface CastFixture {
  qid: string;
  label: string;
  coord: string;
  at?: { qid: string; label: string; ended?: boolean };
  country?: string;
  classes: string[];
}

export interface World {
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
export function doorTo(world: World, asked: CacheDescriptor['kind'][] = []): QueryRunner {
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

export const MONUMENT = 'Q4989906';
export const SCULPTURE = 'Q860861';
export const CATHEDRAL = 'Q56242215';
export const BASILICA = 'Q120560';

/** The place gather asked for this kind alone, and the kind's share of it. */
export async function gatherPublicArt(run: QueryRunner, admitted: ReadonlySet<string>) {
  return shareOf(await gatherPlaces(run, [{ kind: PUBLIC_ART_KIND, admitted }]), PUBLIC_ART_KIND);
}

/** The run as a pass of one source: the gather, then this source's classification. */
export async function collectPublicArt(
  run: QueryRunner, admitted: ReadonlySet<string>, offered?: ReadonlySet<string>, rule: KindRule = PUBLIC_ART_RULE,
) {
  return classifyPublicArt(await gatherPublicArt(run, admitted), rule, admitted, offered);
}
