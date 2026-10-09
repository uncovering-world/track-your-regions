/**
 * What Wikidata is asked to find a World Heritage component an item for
 * (#1272): the classes of the items already resolved, the parts each site's
 * own item names, the items near a group of points, and the labels of the few
 * that stand close enough to be candidates. The rules that choose among the
 * answers are `componentItemMatching.ts`.
 *
 * The query service is asked for identifiers, coordinates and classes only.
 * Asked for every label in every language too, a site item with a few
 * thousand parts made one query heavy enough to spend the client's whole
 * minute of the service's time (Wikidata Query Service User Manual, § Query
 * limits). Labels come from Wikidata's own API (`wbgetentities`), fifty items a
 * request, and only for the candidates the distance leaves.
 */

import { SETTLEMENT_CLASSES, type CandidateItem } from './componentItemMatching.js';
import { askWikipediaOnce } from './wikipediaCategories.js';
import {
  delay, sparqlQuery, SparqlUnanswered, SPARQL_DELAY_MS, WIKIDATA_USER_AGENT,
  type SourceWait, type SparqlBinding, type WaitBudget,
} from './wikidataUtils.js';

const LOG_PREFIX = '[Component items]';
/** Items per `VALUES` block for the class read, which is light. */
const BATCH = 200;
/**
 * Attempts at one part or box query before it is made smaller. A query the
 * service could not answer in its minute will most likely not answer the next
 * time either, and every attempt spends a minute of its time; one retry rides
 * out a busy moment, then the question is split.
 */
const HEAVY_RETRIES = 1;
/** Site items per part query. */
const SITES_PER_QUERY = 50;
/** The most ids `wbgetentities` takes in one request. */
const ENTITY_BATCH = 50;
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

export interface QueryHooks {
  budget: WaitBudget;
  isCancelled?: () => boolean;
  /** Called after each query, so a job can say how far it is. */
  onQuery?: () => void;
  /** Called before a wait, so a job can say the service is holding it. */
  onWait?: (wait: SourceWait) => void;
}

const itemOf = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1);

function coordOf(wkt: string | undefined): [number, number] | null {
  const m = wkt ? /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(wkt) : null;
  return m ? [Number(m[2]), Number(m[1])] : null;
}

/** One query, paced like every other this process sends (`sparqlQuery`'s turn, #1307). */
async function ask(query: string, hooks: QueryHooks, retries?: number): Promise<SparqlBinding[]> {
  const rows = await sparqlQuery(query, LOG_PREFIX, {
    budget: hooks.budget, isCancelled: hooks.isCancelled, onWait: hooks.onWait, retries,
  });
  hooks.onQuery?.();
  return rows;
}

/** Folds an answer's rows into one candidate per item: every coordinate and class it carries, its labels read later. */
function candidatesOf(rows: SparqlBinding[], key: 'item' | 'part'): Map<string, CandidateItem> {
  const byItem = new Map<string, CandidateItem>();
  for (const row of rows) {
    const item = itemOf(row[key]!.value);
    const candidate = byItem.get(item) ?? { item, labels: [], coords: [], classes: [] };
    byItem.set(item, candidate);
    const coord = coordOf(row.coord?.value);
    if (coord && !candidate.coords.some(([a, b]) => a === coord[0] && b === coord[1])) candidate.coords.push(coord);
    for (const name of ['class', 'settlement'] as const) {
      const value = row[name]?.value;
      const cls = value ? itemOf(value) : null;
      if (cls && !candidate.classes!.includes(cls)) candidate.classes!.push(cls);
    }
  }
  return byItem;
}

/** The P31 classes of the given items. */
export async function classesOfItems(items: readonly string[], hooks: QueryHooks): Promise<Map<string, string[]>> {
  const classes = new Map<string, string[]>();
  for (let i = 0; i < items.length; i += BATCH) {
    if (hooks.isCancelled?.()) break;
    const values = items.slice(i, i + BATCH).map(item => `wd:${item}`).join(' ');
    const rows = await ask(`SELECT ?item ?class WHERE { VALUES ?item { ${values} } ?item wdt:P31 ?class . }`, hooks);
    for (const row of rows) {
      const item = itemOf(row.item!.value);
      classes.set(item, [...(classes.get(item) ?? []), itemOf(row.class!.value)]);
    }
  }
  return classes;
}

/**
 * The items each site item names as its part (P361), less those that carry a
 * World Heritage reference of their own: those are already matched by it
 * (#1269), or belong to another site. A batch the service cannot answer in its
 * minute is asked again in halves, down to one site; a site it cannot answer
 * even alone is named in `unread` rather than ending the pass.
 */
export async function partsOfSites(
  siteItems: readonly string[], hooks: QueryHooks,
): Promise<{ parts: Map<string, CandidateItem[]>; unread: string[] }> {
  const parts = new Map<string, CandidateItem[]>();
  const unread: string[] = [];
  const read = async (batch: readonly string[]): Promise<void> => {
    if (hooks.isCancelled?.()) return;
    let rows: SparqlBinding[];
    try {
      rows = await ask(`SELECT ?site ?part ?coord WHERE {
        VALUES ?site { ${batch.map(item => `wd:${item}`).join(' ')} }
        ?part wdt:P361 ?site .
        FILTER NOT EXISTS { ?part wdt:P757 [] }
        OPTIONAL { ?part wdt:P625 ?coord }
      }`, hooks, HEAVY_RETRIES);
    } catch (error) {
      if (!tooHeavy(error)) throw error;
      if (batch.length === 1) { unread.push(batch[0]); return; }
      const half = Math.ceil(batch.length / 2);
      await read(batch.slice(0, half));
      await read(batch.slice(half));
      return;
    }
    const bySite = new Map<string, SparqlBinding[]>();
    for (const row of rows) {
      const site = itemOf(row.site!.value);
      bySite.set(site, [...(bySite.get(site) ?? []), row]);
    }
    for (const [site, siteRows] of bySite) parts.set(site, [...candidatesOf(siteRows, 'part').values()]);
  };
  for (let i = 0; i < siteItems.length; i += SITES_PER_QUERY) await read(siteItems.slice(i, i + SITES_PER_QUERY));
  return { parts, unread };
}

export interface Box { south: number; west: number; north: number; east: number }

const boxPattern = (box: Box) => `{ SERVICE wikibase:box {
        ?item wdt:P625 ?coord .
        bd:serviceParam wikibase:cornerSouthWest "Point(${box.west} ${box.south})"^^geo:wktLiteral .
        bd:serviceParam wikibase:cornerNorthEast "Point(${box.east} ${box.north})"^^geo:wktLiteral .
      } }`;

/**
 * Items inside any of the boxes that are of one of `classes`, less those that
 * carry a World Heritage reference. Several boxes go in one query, joined by
 * `UNION`: the points are scattered over a thousand places, and a query per
 * place spends most of its time waiting its turn. A settlement class an item
 * also has is returned with its classes, so the rule can refuse a village for a
 * site whose parts are not villages.
 */
export async function itemsInBoxes(
  boxes: readonly Box[], classes: readonly string[], hooks: QueryHooks, retries = HEAVY_RETRIES,
): Promise<CandidateItem[]> {
  if (classes.length === 0 || boxes.length === 0) return [];
  const values = classes.map(c => `wd:${c}`).join(' ');
  const settlements = [...SETTLEMENT_CLASSES].map(c => `wd:${c}`).join(' ');
  // The order as written: the boxes first, then the classes. Left to itself the
  // optimizer starts from the classes once the boxes are a UNION, which walks
  // every archaeological site in the world and times out.
  const rows = await ask(`SELECT ?item ?coord ?class ?settlement WHERE {
      hint:Query hint:optimizer "None" .
      ${boxes.map(boxPattern).join('\n      UNION ')}
      VALUES ?class { ${values} }
      ?item wdt:P31 ?class .
      FILTER NOT EXISTS { ?item wdt:P757 [] }
      OPTIONAL { VALUES ?settlement { ${settlements} } ?item wdt:P31 ?settlement . }
    }`, hooks, retries);
  return [...candidatesOf(rows, 'item').values()];
}

/**
 * Whether a failed query ran out of time or out of the service's capacity — a
 * 5xx, a timeout, a dropped connection, after every retry — which a smaller
 * question may still get an answer to (`SparqlUnanswered`). Nothing else is:
 * a 429 or a 403 means the service asked this client to stop, a 400 that the
 * query is wrong, and a spent wait budget that the run has no patience left.
 */
export function tooHeavy(error: unknown): boolean {
  return error instanceof SparqlUnanswered;
}

interface EntityLabels {
  entities?: Record<string, { labels?: Record<string, { value: string }> }>;
}

/**
 * Every label each item has, in every language: a component is often named in
 * its own (*Castrul roman de la Bologa*), and the item may carry that name only
 * there. One request at a time, with a pause between, as the API asks of a
 * reader that is not a person.
 */
export async function labelsOf(items: readonly string[], hooks: QueryHooks): Promise<Map<string, string[]>> {
  const labels = new Map<string, string[]>();
  for (let i = 0; i < items.length; i += ENTITY_BATCH) {
    if (hooks.isCancelled?.()) break;
    if (i > 0) await delay(SPARQL_DELAY_MS);
    const ids = items.slice(i, i + ENTITY_BATCH);
    const answer = await askWikipediaOnce(
      { action: 'wbgetentities', ids: ids.join('|'), props: 'labels', format: 'json', formatversion: '2' },
      {
        userAgent: WIKIDATA_USER_AGENT, endpoint: WIKIDATA_API,
        isCancelled: hooks.isCancelled, onWait: hooks.onWait, budget: hooks.budget,
      },
      hooks.budget,
      `the labels of ${ids.length} candidate items`,
    ) as unknown as EntityLabels;
    hooks.onQuery?.();
    for (const [item, entity] of Object.entries(answer.entities ?? {})) {
      labels.set(item, [...new Set(Object.values(entity.labels ?? {}).map(label => label.value))]);
    }
  }
  return labels;
}
