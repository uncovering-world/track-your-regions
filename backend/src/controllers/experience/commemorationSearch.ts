/**
 * A curator's search for whom or what a place commemorates (#2144): the
 * Wikidata items a name finds, for the "Add a person or event" field of the
 * curation dialog, each with its English label and description, so two people
 * of one name can be told apart, and its English Wikipedia article, which the
 * card links the name to.
 *
 * Two requests to Wikidata's Action API, as the curator's other lookups make
 * them (`lookupByName` and `lookupByQid` in `geocodeController.ts`): the search
 * by name (`wbsearchentities`), then the candidates' English labels,
 * descriptions and English Wikipedia sitelinks in one read (`wbgetentities`).
 * Both are sent in the process's turn for that API (`actionApiFetch`), under
 * the product's User-Agent without the bot marker, since a curator is waiting
 * on them, and under one deadline for the pair. The second read is not
 * optional: a candidate stored without the article it has would be a card line
 * with a name and no link, so a failure of either answers no candidates.
 */

import type { z } from 'zod/v4';
import type { CommemorationCandidate, CommemorationCandidates } from '../../api/responses/curation.js';
import { userAgent } from '../../config/userAgent.js';
import { failure } from '../../middleware/errorHandler.js';
import { actionApiFetch } from '../../services/wikimediaApi.js';
import { articleUrl } from '../../services/sync/subset/values.js';
import type { commemorationSearchQuerySchema } from '../../types/index.js';

// No bot marker: a curator is waiting on the dialog.
const USER_AGENT = userAgent();
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
/** How many candidates a search answers: a list a curator reads at a glance. */
export const SUBJECT_CANDIDATES = 8;
/** How long the two requests may take together: past this the curator has typed on. */
const SUBJECT_SEARCH_TIMEOUT_MS = 10000;
/** A Wikidata item's id, the only kind of entity a subject is. */
const ITEM = /^Q[1-9]\d*$/;

type Text = { value?: unknown } | undefined;

/** One hit of `wbsearchentities`, as far as it is read. */
interface SearchHit {
  id?: unknown;
  label?: unknown;
  description?: unknown;
  display?: { label?: Text; description?: Text };
}

/** One entity of `wbgetentities`, as far as it is read. */
interface ItemFacts {
  labels?: { en?: Text };
  descriptions?: { en?: Text };
  sitelinks?: { enwiki?: { title?: unknown } };
}

const textOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** One Action API answer, read whole; anything but a 200 is a failure of the search. */
async function askWikidata<T>(params: Record<string, string>, signal: AbortSignal): Promise<T> {
  const url = new URL(WIKIDATA_API);
  for (const [name, value] of Object.entries({ ...params, format: 'json' })) url.searchParams.set(name, value);
  const response = await actionApiFetch(url.toString(), { headers: { 'User-Agent': USER_AGENT }, signal }, {});
  if (!response.ok) throw new Error(`Wikidata answered ${response.status}`);
  return await response.json() as T;
}

/** The items the name finds, best match first, at most `SUBJECT_CANDIDATES`. */
async function searchItems(name: string, signal: AbortSignal): Promise<Array<SearchHit & { id: string }>> {
  const data = await askWikidata<{ search?: SearchHit[] }>({
    action: 'wbsearchentities', search: name, type: 'item',
    language: 'en', uselang: 'en', limit: String(SUBJECT_CANDIDATES),
  }, signal);
  return (data.search ?? [])
    .filter((hit): hit is SearchHit & { id: string } => typeof hit.id === 'string' && ITEM.test(hit.id))
    .slice(0, SUBJECT_CANDIDATES);
}

/** The English label, description and English Wikipedia sitelink of each item, by its id. */
async function factsOf(items: readonly string[], signal: AbortSignal): Promise<Record<string, ItemFacts>> {
  if (items.length === 0) return {};
  const data = await askWikidata<{ entities?: Record<string, ItemFacts> }>({
    action: 'wbgetentities', ids: items.join('|'),
    props: 'sitelinks|labels|descriptions', languages: 'en', sitefilter: 'enwiki',
  }, signal);
  return data.entities ?? {};
}

/**
 * One candidate, or null where nothing names it: the English label, else the
 * label the search showed (an item with none in English is still the person
 * the curator typed); the article is the English sitelink, spelled as a run
 * spells it (`articleUrl`).
 */
export function candidateOf(hit: SearchHit & { id: string }, facts: ItemFacts | undefined): CommemorationCandidate | null {
  const label = textOf(facts?.labels?.en?.value) ?? textOf(hit.display?.label?.value) ?? textOf(hit.label);
  if (!label) return null;
  const description = textOf(facts?.descriptions?.en?.value) ?? textOf(hit.display?.description?.value)
    ?? textOf(hit.description);
  const title = textOf(facts?.sitelinks?.enwiki?.title);
  return { item: hit.id, label, description, articleUrl: title ? articleUrl(title) : null };
}

/**
 * GET /api/experiences/commemorates/search?q=
 * The Wikidata items a name finds, for a curator's list of whom a place
 * commemorates. 502 where Wikidata does not answer within the deadline.
 */
export async function searchCommemorationSubjects(
  { query: { q } }: { query: z.output<typeof commemorationSearchQuerySchema> },
): Promise<CommemorationCandidates> {
  const signal = AbortSignal.timeout(SUBJECT_SEARCH_TIMEOUT_MS);
  try {
    const hits = await searchItems(q, signal);
    const facts = await factsOf(hits.map((hit) => hit.id), signal);
    return {
      candidates: hits
        .map((hit) => candidateOf(hit, facts[hit.id]))
        .filter((candidate): candidate is CommemorationCandidate => candidate !== null),
    };
  } catch (error) {
    console.error('Commemorated subject search error:', error);
    throw failure('Wikidata search failed', 502);
  }
}
