/**
 * What the component-item search (#1272) still asks of Wikidata's own API
 * (`wbgetentities`): the labels of the few items that stand close enough to
 * be candidates, in every language, and the picture and description of an
 * item a curator confirms. Everything else the search reads comes from the
 * local Wikidata subset (`subset/componentItems.ts`, #1435), which keeps
 * labels in eight languages only, while a component is often named in its
 * own: Romanian for Dacia's castra. Fifty items a request, one request at a
 * time with a pause between, as the API asks of a reader that is not a
 * person.
 */

import { askWikipediaOnce } from './wikipediaCategories.js';
import { delay, SPARQL_DELAY_MS, WIKIDATA_USER_AGENT, type SourceWait, type WaitBudget } from './wikidataUtils.js';

/** The most ids `wbgetentities` takes in one request. */
const ENTITY_BATCH = 50;
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

export interface QueryHooks {
  budget: WaitBudget;
  isCancelled?: () => boolean;
  /** Called after each request to Wikidata's API, so a pass can count the requests it sent (`ComponentItemReport.queries`). */
  onQuery?: () => void;
  /**
   * Called with how many of the asked-about items (or areas) an answer covered,
   * so a step can say how much of its own work is done (#1356).
   */
  onAnswered?: (count: number) => void;
  /** Called before a wait, so a job can say the service is holding it. */
  onWait?: (wait: SourceWait) => void;
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
