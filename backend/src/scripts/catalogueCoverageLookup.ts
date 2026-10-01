/**
 * The lookups a survey makes while a region's list is compiled (ADR-0081):
 * what Wikivoyage names, which Wikidata items a name could be, and what
 * Wikidata holds about an item.
 *
 * It exists so that an identifier on a survey list is always one a search
 * returned and a distance confirmed, never one written from memory. It reads
 * and prints; it writes no list and touches no database.
 *
 *   wikivoyage <Title>... [--save <dir>]   what each article names, by section, and the districts and day trips it links
 *   search <phrase>...                     the Wikidata items a name could be
 *   facts <lat> <lon> <Qid>...             label, sitelinks, distance from the centre and classes of each item
 *
 * A phrase or a title with spaces is one quoted argument. Phrases and ids are
 * also read from standard input, one per line, when none is given.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { userAgent } from '../config/userAgent.js';

const WIKIVOYAGE_API = 'https://en.wikivoyage.org/w/api.php';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const USER_AGENT = userAgent({ bot: true, purpose: 'catalogue coverage survey' });
/** Both sites ask an automated reader to keep its calls apart. */
const PAUSE_MS = 400;
const RETRIES = 4;
/** The most ids `wbgetentities` takes in one call. */
const ENTITY_BATCH = 50;

/** The sections of a Wikivoyage article a survey reads. */
/** `Go next` is where an article names its day trips. */
const NAVIGATION = ['Districts', 'Regions', 'Cities', 'Other destinations', 'Go next'];
const LISTINGS = ['See', 'Do', 'Buy', 'Eat', 'Drink', 'Sleep'];

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/** The API's errors that pass on their own: asked again, they answer. */
const TRANSIENT = /^(ratelimited|maxlag|readonly|internal_api_error)/;

/**
 * What a MediaWiki answer refuses, if anything. The API reports an error with
 * HTTP 200 and an `error` object, so a status check alone reads a refusal as an
 * answer with nothing in it. A missing page is an answer, not a refusal.
 */
export function refusalOf(answer: Record<string, unknown>): { code: string; transient: boolean } | null {
  const code = (answer.error as { code?: unknown } | undefined)?.code;
  if (typeof code !== 'string' || code === 'missingtitle') return null;
  return { code, transient: TRANSIENT.test(code) };
}

/** The API answered, and the answer is no: asking again would not change it. */
class ApiRefusal extends Error {}

/** One call: the answer, or why there is none yet and how long to wait before asking again. */
async function ask(api: string, url: string, attempt: number): Promise<{ answer: Record<string, unknown> } | { failure: string; wait: number }> {
  const patience = 2000 * (attempt + 1);
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    // A 429 says when to come back; anything else is waited out a little longer each time.
    return { failure: `HTTP ${response.status}`, wait: Number(response.headers.get('retry-after')) * 1000 || patience };
  }
  const answer = await response.json() as Record<string, unknown>;
  const refusal = refusalOf(answer);
  if (!refusal) return { answer };
  if (!refusal.transient) throw new ApiRefusal(`${api} refused ${url}: ${refusal.code}`);
  return { failure: `the API's error "${refusal.code}"`, wait: patience };
}

async function apiGet(api: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = `${api}?${new URLSearchParams({ ...params, format: 'json' }).toString()}`;
  let lastFailure = 'no attempt was made';
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    await sleep(PAUSE_MS);
    let wait = 2000 * (attempt + 1);
    try {
      const result = await ask(api, url, attempt);
      if ('answer' in result) return result.answer;
      ({ failure: lastFailure, wait } = result);
    } catch (error) {
      // A refusal is final. A request that never got an answer, a dropped connection, is asked again.
      if (error instanceof ApiRefusal) throw error;
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await sleep(wait);
  }
  throw new Error(`${api} did not answer: ${lastFailure}`);
}

// --- Wikivoyage -------------------------------------------------------------

export interface ArticleSection {
  heading: string;
  /** Names of the listings in the section, in order. */
  listings: string[];
  /** How many of them carry a Wikidata id. The id is a hint: listings carry wrong ones in places. */
  withWikidata: number;
  /** For a section that lists districts or destinations: the articles it links. */
  linked: string[];
}

/** `[[Target|Shown]]` and `[[Target]]` as the words a reader sees. */
function plain(text: string): string {
  let words = '';
  let rest = text;
  for (;;) {
    const open = rest.indexOf('[[');
    const close = open < 0 ? -1 : rest.indexOf(']]', open);
    if (close < 0) return (words + rest).trim();
    words += rest.slice(0, open) + (rest.slice(open + 2, close).split('|').pop() ?? '');
    rest = rest.slice(close + 2);
  }
}

/** The value of a listing's `name=`: up to the next parameter or line, a `|` inside a link not counting. */
function nameOf(listing: string): string {
  const at = listing.search(/\bname\s*=/);
  if (at < 0) return '';
  const value = listing.slice(listing.indexOf('=', at) + 1);
  let depth = 0;
  let end = value.length;
  for (let index = 0; index < value.length; index++) {
    const two = value.slice(index, index + 2);
    if (two === '[[') depth += 1;
    else if (two === ']]') depth = Math.max(0, depth - 1);
    else if (value[index] === '\n' || (depth === 0 && (value[index] === '|' || two === '}}'))) {
      end = index;
      break;
    }
  }
  return plain(value.slice(0, end));
}

/** The listing templates of a section, each as its own text. */
function listingsOf(body: string): string[] {
  const found: string[] = [];
  for (const start of body.matchAll(/\{\{\s*(?:see|do|buy|eat|drink|sleep|listing|marker)\b/gi)) {
    const close = body.indexOf('}}', start.index);
    found.push(body.slice(start.index, close < 0 ? body.length : close + 2));
  }
  return found;
}

/** What a Wikivoyage article's wikitext names, section by section. */
export function readArticle(wikitext: string): ArticleSection[] {
  const parts = wikitext.split(/\n==([^=].*?)==\n/);
  const sections: ArticleSection[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    const heading = parts[index].trim();
    const body = parts[index + 1] ?? '';
    if (!NAVIGATION.includes(heading) && !LISTINGS.includes(heading)) continue;
    const listings = listingsOf(body).map(nameOf).filter(name => name !== '');
    const linked = NAVIGATION.includes(heading)
      ? [...new Set([...body.matchAll(/\[\[([^\]|#]+)/g)].map(match => match[1].trim()))]
        .filter(title => !/^(File|Image):/i.test(title)).sort((a, b) => a.localeCompare(b))
      : [];
    sections.push({ heading, listings, withWikidata: [...body.matchAll(/wikidata=\s*Q\d+/g)].length, linked });
  }
  return sections;
}

async function wikivoyage(titles: string[], saveDir: string | undefined): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the directory the operator named with --save
  if (saveDir) mkdirSync(saveDir, { recursive: true });
  for (const asked of titles) {
    const answer = await apiGet(WIKIVOYAGE_API, { action: 'parse', page: asked, prop: 'wikitext', redirects: '1' });
    const parsed = answer.parse as { title: string; wikitext: { '*': string } } | undefined;
    if (!parsed) {
      console.log(`== ${asked}: no such article`);
      continue;
    }
    const wikitext = parsed.wikitext['*'];
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- under the operator's --save directory, the article title with its slashes replaced
    if (saveDir) writeFileSync(join(saveDir, `${parsed.title.replace(/\//g, '_')}.wiki`), wikitext);
    console.log(`== ${parsed.title} (${wikitext.length} characters)`);
    for (const section of readArticle(wikitext)) {
      console.log(`   ${section.heading}: ${section.listings.length} listings, ${section.withWikidata} with a Wikidata id`);
      if (section.listings.length > 0) console.log(`      ${section.listings.join('; ')}`);
      if (section.linked.length > 0) console.log(`      links: ${section.linked.join('; ')}`);
    }
  }
}

// --- Wikidata ---------------------------------------------------------------

interface Candidate { id: string; label: string; description: string }

async function candidates(phrase: string): Promise<{ how: string; found: Candidate[] }> {
  const byName = await apiGet(WIKIDATA_API, { action: 'wbsearchentities', search: phrase, language: 'en', uselang: 'en', limit: '4' });
  const named = (byName.search as { id: string; label?: string; description?: string }[] | undefined) ?? [];
  if (named.length > 0) {
    return { how: 'by name', found: named.map(hit => ({ id: hit.id, label: hit.label ?? '', description: hit.description ?? '' })) };
  }
  // The name search matches labels and aliases only; the full-text search also finds "Mercado Central de San Pedro Cusco".
  const byText = await apiGet(WIKIDATA_API, { action: 'query', list: 'search', srsearch: phrase, srlimit: '4' });
  const ids = ((byText.query as { search?: { title: string }[] } | undefined)?.search ?? []).map(hit => hit.title);
  if (ids.length === 0) return { how: 'nothing found', found: [] };
  const entities = await entitiesOf(ids, 'labels|descriptions');
  const words = (terms: Record<string, { value: string }> | undefined) =>
    terms?.en?.value ?? Object.values(terms ?? {})[0]?.value ?? '';
  return {
    how: 'by full text',
    found: ids.map(id => ({ id, label: words(entities[id]?.labels), description: words(entities[id]?.descriptions) })),
  };
}

interface Entity {
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  sitelinks?: Record<string, unknown>;
  claims?: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]>;
}

async function entitiesOf(ids: string[], props: string): Promise<Record<string, Entity>> {
  const entities: Record<string, Entity> = {};
  for (let start = 0; start < ids.length; start += ENTITY_BATCH) {
    const answer = await apiGet(WIKIDATA_API, { action: 'wbgetentities', ids: ids.slice(start, start + ENTITY_BATCH).join('|'), props });
    Object.assign(entities, answer.entities as Record<string, Entity>);
  }
  return entities;
}

/** Great-circle distance in kilometres. */
export function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export interface ItemFacts {
  id: string;
  label: string;
  /** Every sitelink, the number Wikidata's own count reports. */
  sitelinks: number;
  /** Null when the item has no coordinates. */
  lat: number | null;
  lon: number | null;
  /** The ids of what the item is an instance of. */
  classes: string[];
}

/** What a survey list keeps of a Wikidata item. */
export function factsOf(id: string, entity: Entity | undefined): ItemFacts {
  const values = (property: string) => (entity?.claims?.[property] ?? [])
    .map(claim => claim.mainsnak.datavalue?.value).filter(value => value !== undefined);
  const point = values('P625')[0] as { latitude: number; longitude: number } | undefined;
  return {
    id,
    label: entity?.labels?.en?.value ?? '(no English label)',
    sitelinks: Object.keys(entity?.sitelinks ?? {}).length,
    lat: point ? Math.round(point.latitude * 1e5) / 1e5 : null,
    lon: point ? Math.round(point.longitude * 1e5) / 1e5 : null,
    classes: values('P31').map(value => (value as { id: string }).id),
  };
}

async function search(phrases: string[]): Promise<void> {
  for (const phrase of phrases) {
    const { how, found } = await candidates(phrase);
    console.log(`## ${phrase} (${how})`);
    for (const hit of found) console.log(`   ${hit.id} | ${hit.label} | ${hit.description.slice(0, 100)}`);
  }
}

async function facts(lat: number, lon: number, ids: string[]): Promise<void> {
  const entities = await entitiesOf(ids, 'labels|claims|sitelinks');
  const items = ids.map(id => factsOf(id, entities[id]));
  const classNames = await entitiesOf([...new Set(items.flatMap(item => item.classes))], 'labels');
  for (const item of items) {
    const distance = item.lat === null || item.lon === null
      ? 'NO-COORD'
      : `${Math.round(kmBetween({ lat, lon }, { lat: item.lat, lon: item.lon }))} km`;
    const classes = item.classes.map(id => classNames[id]?.labels?.en?.value ?? id).join('; ');
    console.log([item.id, item.label, item.sitelinks, distance, item.lat ?? '', item.lon ?? '', classes].join('\t'));
  }
}

// --- Command line -----------------------------------------------------------

async function fromStdin(): Promise<string[]> {
  if (process.stdin.isTTY) return [];
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').split('\n').map(line => line.trim()).filter(line => line !== '');
}

const USAGE = 'Usage: wikivoyage <Title>... [--save <dir>] | search <phrase>... | facts <lat> <lon> <Qid>...';

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'wikivoyage') {
    const saveFlag = rest.indexOf('--save');
    // A relative path is taken from where the command was typed: `npm --prefix backend run`
    // moves the working directory to `backend/` and leaves the caller's in `INIT_CWD`.
    const saveDir = saveFlag >= 0 && rest[saveFlag + 1] ? resolvePath(process.env.INIT_CWD ?? process.cwd(), rest[saveFlag + 1]) : undefined;
    const titles = rest.filter((_, index) => saveFlag < 0 || (index !== saveFlag && index !== saveFlag + 1));
    await wikivoyage(titles.length > 0 ? titles : await fromStdin(), saveDir);
  } else if (command === 'search') {
    await search(rest.length > 0 ? rest : await fromStdin());
  } else if (command === 'facts') {
    const [lat, lon, ...ids] = rest;
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
      console.error(USAGE);
      process.exit(2);
    }
    const asked = ids.length > 0 ? ids : await fromStdin();
    await facts(Number(lat), Number(lon), asked.map(line => line.split(/\s/)[0]).filter(id => /^Q[1-9]\d*$/.test(id)));
  } else {
    console.error(USAGE);
    process.exit(2);
  }
}

// Only run main() when invoked directly, not when imported by a spec.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
