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

import { FIND_RECORD_CLASSES, type CandidateItem } from './componentItemMatching.js';
import { REGISTER_CODES, type ItemCode } from './componentItemRegisters.js';
import { askWikipediaOnce } from './wikipediaCategories.js';
import { qleverWikidataQuery } from './qleverWikidata.js';
import {
  delay, sparqlQuery, SparqlUnanswered, SPARQL_DELAY_MS, WIKIDATA_USER_AGENT,
  type SourceWait, type SparqlBinding, type WaitBudget,
} from './wikidataUtils.js';

const LOG_PREFIX = '[Component items]';
/** Items per `VALUES` block for the class read, which is light. */
const BATCH = 200;
/**
 * Attempts at one part query before it is made smaller. A query the service
 * could not answer in its minute will most likely not answer the next time
 * either, and every attempt spends a minute of its time; one retry rides out
 * a busy moment, then the question is split.
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
  /** Called after each query, so a pass can count the questions it sent (`ComponentItemReport.queries`). */
  onQuery?: () => void;
  /**
   * Called with how many of the asked-about items (or areas) an answer covered,
   * so a step can say how much of its own work is done (#1356).
   */
  onAnswered?: (count: number) => void;
  /** Called before a wait, so a job can say the service is holding it. */
  onWait?: (wait: SourceWait) => void;
}

const itemOf = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1);

function coordOf(wkt: string | undefined): [number, number] | null {
  // The query service writes `Point(…)`, QLever `POINT(…)`.
  const m = wkt ? /Point\(([-\d.e]+) ([-\d.e]+)\)/i.exec(wkt) : null;
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
    const cls = row.class?.value ? itemOf(row.class.value) : null;
    if (cls && !candidate.classes!.includes(cls)) candidate.classes!.push(cls);
    const whc = row.whc?.value?.trim();
    if (whc) {
      candidate.references ??= [];
      if (!candidate.references.includes(whc)) candidate.references.push(whc);
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
    hooks.onAnswered?.(Math.min(BATCH, items.length - i));
  }
  return classes;
}

/**
 * The national register codes the given items carry (`REGISTER_CODES`, #1340),
 * asked only of the items a pass proposes: a handful of questions to the
 * query service, never to QLever, whose budget is the near search's.
 */
export async function registerCodesOf(items: readonly string[], hooks: QueryHooks): Promise<Map<string, ItemCode[]>> {
  const codes = new Map<string, ItemCode[]>();
  const properties = REGISTER_CODES.map(r => `wdt:${r.property}`).join(' ');
  for (let i = 0; i < items.length; i += BATCH) {
    if (hooks.isCancelled?.()) break;
    const values = items.slice(i, i + BATCH).map(item => `wd:${item}`).join(' ');
    const rows = await ask(`SELECT ?item ?property ?code WHERE {
      VALUES ?item { ${values} }
      VALUES ?property { ${properties} }
      ?item ?property ?code .
    }`, hooks);
    for (const row of rows) {
      const item = itemOf(row.item!.value);
      const code = { property: itemOf(row.property!.value), code: row.code!.value };
      codes.set(item, [...(codes.get(item) ?? []), code].sort((a, b) => a.property.localeCompare(b.property) || a.code.localeCompare(b.code)));
    }
    hooks.onAnswered?.(Math.min(BATCH, items.length - i));
  }
  return codes;
}

/**
 * The items each site item names as its part (P361), with or without a World
 * Heritage reference of their own: one the reference reader matched (#1269)
 * is a point's item already and the finder leaves it as taken; one it could
 * not match — a component the list numbers under a later variant of the
 * inscription than Wikidata does — stays a candidate for a curator, with its
 * references carried so the finder leaves out a part that claims another
 * site (#1344). A batch the service cannot answer in its
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
      rows = await ask(`SELECT ?site ?part ?coord ?whc WHERE {
        VALUES ?site { ${batch.map(item => `wd:${item}`).join(' ')} }
        ?part wdt:P361 ?site .
        OPTIONAL { ?part wdt:P625 ?coord }
        OPTIONAL { ?part wdt:P757 ?whc }
      }`, hooks, HEAVY_RETRIES);
    } catch (error) {
      if (!tooHeavy(error)) throw error;
      if (batch.length === 1) { unread.push(batch[0]); hooks.onAnswered?.(1); return; }
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
    hooks.onAnswered?.(batch.length);
  };
  for (let i = 0; i < siteItems.length; i += SITES_PER_QUERY) await read(siteItems.slice(i, i + SITES_PER_QUERY));
  return { parts, unread };
}

/**
 * Every item that carries a component's World Heritage number (#1394), with
 * the numbers it carries and its coordinates, in one question: some five
 * thousand statements on 2026-10-12, answered in under two seconds. A number
 * stated only as deprecated is left out, as the reference reader leaves it.
 */
export async function componentNumbers(hooks: QueryHooks): Promise<CandidateItem[]> {
  const rows = await ask(`SELECT ?item ?whc ?coord WHERE {
    ?item p:P757 ?statement . ?statement ps:P757 ?whc .
    FILTER(CONTAINS(?whc, "-"))
    FILTER NOT EXISTS { ?statement wikibase:rank wikibase:DeprecatedRank }
    OPTIONAL { ?item wdt:P625 ?coord }
  }`, hooks);
  hooks.onAnswered?.(1);
  return [...candidatesOf(rows, 'item').values()];
}

export interface Box { south: number; west: number; north: number; east: number }

/** QLever declares no prefixes of its own, unlike the Wikidata Query Service. */
const QLEVER_PREFIXES = `PREFIX wd: <http://www.wikidata.org/entity/>
    PREFIX wdt: <http://www.wikidata.org/prop/direct/>
    PREFIX geof: <http://www.opengis.net/def/function/geosparql/>`;

/**
 * One box as a filter on an item's latitude and longitude. A box that runs past
 * the antimeridian (a margin around Kiribati's or Fiji's points) takes its other
 * side too, since longitudes there jump from 180 to -180.
 */
export function boxFilter(box: Box): string {
  const lon = (west: number, east: number) => `?lon >= ${west} && ?lon <= ${east}`;
  const sides = [lon(Math.max(box.west, -180), Math.min(box.east, 180))];
  if (box.east > 180) sides.push(lon(-180, box.east - 360));
  if (box.west < -180) sides.push(lon(box.west + 360, 180));
  return `(?lat >= ${box.south} && ?lat <= ${box.north} && (${sides.join(' || ')}))`;
}

/**
 * Items inside any of the boxes that are of one of `classes`, less those that
 * carry a World Heritage reference or record a find or a dig
 * (`FIND_RECORD_CLASSES` or a class under one: an item's answer names only
 * the classes asked about, so the record class is refused here or nowhere), asked of Wikidata on QLever
 * (`qleverWikidata.ts`): the near rule reads the coordinates of whole classes
 * around a thousand places, which the Wikidata Query Service throttled even
 * paced at its own published rate, and which an unloaded mirror answers in
 * under a second — a loaded one in about 15 s, and then refuses the pass
 * (the register's record for the mirror), so a pass a day is the budget.
 * Many boxes go in one question, as one filter over the class's
 * coordinates. Which of the answers are settlements is a second question
 * (`settlementsAmong`), asked of the class tree rather than read off a list.
 */
export async function itemsInBoxes(
  boxes: readonly Box[], classes: readonly string[], hooks: QueryHooks,
): Promise<CandidateItem[]> {
  if (classes.length === 0 || boxes.length === 0 || hooks.isCancelled?.()) return [];
  const values = classes.map(c => `wd:${c}`).join(' ');
  const findRecordValues = Object.keys(FIND_RECORD_CLASSES).map(c => `wd:${c}`).join(' ');
  const rows = await qleverWikidataQuery(`${QLEVER_PREFIXES}
    SELECT ?item ?coord ?class WHERE {
      VALUES ?class { ${values} }
      ?item wdt:P31 ?class .
      ?item wdt:P625 ?coord .
      BIND(geof:latitude(?coord) AS ?lat)
      BIND(geof:longitude(?coord) AS ?lon)
      FILTER(${boxes.map(boxFilter).join('\n        || ')})
      FILTER NOT EXISTS { ?item wdt:P757 ?reference }
      FILTER NOT EXISTS { VALUES ?record { ${findRecordValues} } ?item wdt:P31/wdt:P279* ?record }
    }`, hooks.isCancelled);
  hooks.onQuery?.();
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

/** An item's labels: every one, for matching, and the English one a curator reads the item by. */
export interface ItemLabels {
  all: string[];
  /**
   * The label in the product's language, or null where the item has none: its
   * English label, else its multilingual one (`mul`), which Wikidata uses for a
   * name every language spells alike and which often stands in for `en`.
   */
  english: string | null;
}

/**
 * Every label each item has, in every language: a component is often named in
 * its own (*Castrul roman de la Bologa*), and the item may carry that name only
 * there. The English label is kept apart as well: it is the one the card
 * names the item by (#1358), since the most name-alike label is whatever
 * language a trigram happened to favour. One request at a time, with a pause
 * between, as the API asks of a reader that is not a person.
 */
export async function labelsOf(items: readonly string[], hooks: QueryHooks): Promise<Map<string, ItemLabels>> {
  const labels = new Map<string, ItemLabels>();
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
      labels.set(item, {
        all: [...new Set(Object.values(entity.labels ?? {}).map(label => label.value))],
        english: entity.labels?.en?.value ?? entity.labels?.mul?.value ?? null,
      });
    }
    hooks.onAnswered?.(ids.length);
  }
  return labels;
}

/** What an item gives the component a curator confirms it is (#1272): its picture and its description. */
export interface ItemContent {
  /** The item's picture as a Commons file address, or null where it states none. */
  image: string | null;
  description: string | null;
}

interface EntityContents {
  entities?: Record<string, {
    descriptions?: Record<string, { value: string }>;
    claims?: Record<string, Array<{ rank?: string; mainsnak?: { datavalue?: { value?: unknown } } }>>;
  }>;
}

/**
 * A Commons file name as the catalogue stores a picture: the `Special:FilePath`
 * address the query service writes for P18, every character outside the
 * unreserved set percent-encoded — a space as `%20`, a parenthesis as `%28` —
 * so a file the run read through SPARQL and the same file read here are one
 * address, which is how a point takes the credit another point holds for it.
 */
export function commonsFilePath(name: string): string {
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `http://commons.wikimedia.org/wiki/Special:FilePath/${encoded}`;
}

/**
 * The picture and the English description of each item, read when a curator
 * confirms a candidate: the run's index knows only the items that carry a
 * World Heritage reference the reader matched, and a candidate is read here
 * whatever it carries. One
 * picture per item, the first by its address (ADR-0085's rule), from the
 * statements that are not deprecated. Through the same API and at the same
 * pace as the labels.
 */
export async function contentsOf(items: readonly string[], hooks: QueryHooks): Promise<Map<string, ItemContent>> {
  const contents = new Map<string, ItemContent>();
  for (let i = 0; i < items.length; i += ENTITY_BATCH) {
    if (hooks.isCancelled?.()) break;
    if (i > 0) await delay(SPARQL_DELAY_MS);
    const ids = items.slice(i, i + ENTITY_BATCH);
    const answer = await askWikipediaOnce(
      {
        action: 'wbgetentities', ids: ids.join('|'), props: 'claims|descriptions', languages: 'en',
        format: 'json', formatversion: '2',
      },
      {
        userAgent: WIKIDATA_USER_AGENT, endpoint: WIKIDATA_API,
        isCancelled: hooks.isCancelled, onWait: hooks.onWait, budget: hooks.budget,
      },
      hooks.budget,
      `the pictures and descriptions of ${ids.length} confirmed items`,
    ) as unknown as EntityContents;
    hooks.onQuery?.();
    for (const [item, entity] of Object.entries(answer.entities ?? {})) {
      const pictures = (entity.claims?.P18 ?? [])
        .filter(claim => claim.rank !== 'deprecated')
        .map(claim => claim.mainsnak?.datavalue?.value)
        .filter((value): value is string => typeof value === 'string' && value !== '')
        .map(commonsFilePath)
        .sort();
      contents.set(item, { image: pictures[0] ?? null, description: entity.descriptions?.en?.value ?? null });
    }
  }
  return contents;
}

/** Items or classes per settlement question. */
const SETTLEMENT_BATCH = 400;

/**
 * Which of the given items are settlements — a town, a village, a commune —
 * or, with `asClasses`, which of the given classes are kinds of settlement.
 * Through the whole class tree (P31/P279*, P279*), which the query service
 * cannot walk for a few hundred items within its limits and QLever answers in
 * a second. A list of classes cannot keep up with Wikidata's: Passau's old
 * town is an *Altstadt*, a class under *human settlement* no list named.
 *
 * A settlement is an item with a class that is a kind of human settlement
 * (Q486972) and is not itself a kind of fortification (Q57821) or of
 * archaeological site (Q839954). Judged class by class, not item by item:
 * Wikidata files a castrum under all three, so a Roman fort is no settlement,
 * while Tarentum is a *city* beside being a *polis* — a dig — and a city is
 * what the near rule must set aside for a site whose parts are not towns.
 */
export async function settlementsAmong(
  ids: readonly string[], hooks: QueryHooks, asClasses = false,
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += SETTLEMENT_BATCH) {
    if (hooks.isCancelled?.()) break;
    const values = ids.slice(i, i + SETTLEMENT_BATCH).map(id => `wd:${id}`).join(' ');
    // For an item, the class is its own P31; for a class, the class itself.
    const [bind, up] = asClasses ? ['BIND(?item AS ?class)', 'wdt:P279*'] : ['?item wdt:P31 ?class .', 'wdt:P279*'];
    const rows = await qleverWikidataQuery(`${QLEVER_PREFIXES}
      SELECT DISTINCT ?item WHERE {
        VALUES ?item { ${values} }
        ${bind}
        ?class ${up} wd:Q486972 .
        FILTER NOT EXISTS { ?class ${up} wd:Q57821 }
        FILTER NOT EXISTS { ?class ${up} wd:Q839954 }
      }`, hooks.isCancelled);
    hooks.onQuery?.();
    for (const row of rows) found.add(itemOf(row.item!.value));
    hooks.onAnswered?.(Math.min(SETTLEMENT_BATCH, ids.length - i));
  }
  return found;
}

/** Items per question about the places they stand in. */
const PLACE_BATCH = 400;

/** A place an item stands in (P131, P276) or is part of (P361), as the near rule reads it. */
export interface StandingPlace {
  item: string;
  /** Its English and multilingual names. */
  names: string[];
  /** Every coordinate it states. */
  coords: Array<[lat: number, lon: number]>;
  /** Whether it carries a World Heritage reference of its own: then the reference reader is what finds it, never the near rule. */
  referenced: boolean;
}

/**
 * The places each item stands in (P131, P276) or is part of (P361), with their
 * English or multilingual names, coordinates and whether they carry a World
 * Heritage reference, asked of QLever: what tells a museum in Herrnhut from the
 * settlement of Herrnhut (`standsAtTheComponent`), and what offers the islet of
 * Mjölnareholmen in the place of the gunpowder house on it
 * (`placeAsCandidate`). An item that names no such place
 * is absent from the answer.
 */
export async function placesOf(items: readonly string[], hooks: QueryHooks): Promise<Map<string, StandingPlace[]>> {
  const places = new Map<string, Map<string, StandingPlace>>();
  for (let i = 0; i < items.length; i += PLACE_BATCH) {
    if (hooks.isCancelled?.()) break;
    const values = items.slice(i, i + PLACE_BATCH).map(id => `wd:${id}`).join(' ');
    const rows = await qleverWikidataQuery(`${QLEVER_PREFIXES}
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT DISTINCT ?item ?place ?name ?coord ?reference WHERE {
        VALUES ?item { ${values} }
        VALUES ?held { wdt:P131 wdt:P276 wdt:P361 }
        ?item ?held ?place .
        ?place rdfs:label ?name .
        FILTER(LANG(?name) = "en" || LANG(?name) = "mul")
        OPTIONAL { ?place wdt:P625 ?coord }
        OPTIONAL { ?place wdt:P757 ?reference }
      }`, hooks.isCancelled);
    hooks.onQuery?.();
    for (const row of rows) {
      const item = itemOf(row.item!.value);
      const id = itemOf(row.place!.value);
      const ofItem = places.get(item) ?? places.set(item, new Map()).get(item)!;
      const place = ofItem.get(id) ?? ofItem.set(id, { item: id, names: [], coords: [], referenced: false }).get(id)!;
      if (!place.names.includes(row.name!.value)) place.names.push(row.name!.value);
      const coord = coordOf(row.coord?.value);
      if (coord && !place.coords.some(([lat, lon]) => lat === coord[0] && lon === coord[1])) place.coords.push(coord);
      if (row.reference) place.referenced = true;
    }
    hooks.onAnswered?.(Math.min(PLACE_BATCH, items.length - i));
  }
  return new Map([...places].map(([item, ofItem]) => [item, [...ofItem.values()]]));
}
