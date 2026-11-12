/**
 * The seventh step of the commemorates reading (#2472, ADR-0201): a
 * dedication stated only in the lead of a place's English Wikipedia article.
 * The Shaheed Minar in Dhaka carries no *commemorates* statement and no
 * memorials category; its lead says it was "established to commemorate those
 * killed during the Bengali language movement".
 *
 * Read for a place of Public art or Monuments & memorials that none of the six
 * earlier steps names a dedication for. Two language models, one from each
 * provider (`leadDedicationModels.ts`), are asked alone which of the lead's
 * own links names whom or what the place was raised to commemorate, honour,
 * mark or be dedicated to, the answer constrained to those links' titles or
 * "none" (`dedicationSchema`). A dedication is written only where
 *
 * 1. both name the same linked article (`agreedLink`),
 * 2. that article resolves to an item, as a category's title does, and
 * 3. the item is a human, an occurrence or a group of people
 *    (`dedicatedTo`): a country named for its independence (Ghana), a topic
 *    or a place is none.
 *
 * What the rule was measured to get is ADR-0201's. The value is
 * written as every step's is (`via: 'lead'`), with no suggestion waiting on a
 * curator first, and takes the run's path as theirs does; a curator's claim on
 * the line still wins.
 *
 * Two runs of one model differ on about a tenth of the places, so each answer
 * is kept per article revision (`workbench.lead_dedication_readings`): a model
 * is asked about a lead only where no answer of its own holds the lead's
 * current revision, and a lead that did not change keeps its reading from one
 * pass to the next. A failed call keeps nothing, and the place is asked again
 * on the next pass. A deployment without both keys reads no lead.
 */

// ADR-0064: raw parameterized SQL on the pool, typed by the generated rows.
import { pool } from '../../../db/index.js';
import type { LeadDedicationReadingsRow } from '../../../db/schema.generated.js';
import {
  leadDedicationModels, leadInstructions, type DedicationModel, type StructuredQuestion,
} from '../../ai/leadDedicationModels.js';
import { sanitizePromptData } from '../../ai/openaiShared.js';
import { enwikiTitleOf } from '../wikipediaCategories.js';
import { articleUrl } from '../subset/values.js';
import type { CommemorationPlace, CommemorationWiki, PlaceReading, SubjectKind } from './commemorates.js';
import { markedLead, type Lead } from './warNarrowing.js';

/** The link of an answer that names none. */
const NONE = 'none';

/**
 * The most of a lead a model reads, in characters: the measured leads took
 * about 1,400 tokens of Claude's input, and a lead several times as long is
 * still read whole.
 */
const MAX_LEAD_CHARS = 12_000;

/** The wiki the kept answers are of. */
const WIKI = 'enwiki';

/** How many places are asked about at once, each of them of both models together. */
const CONCURRENT_PLACES = 4;

/** The answer's shape: whether a dedication is stated, and which of the lead's links names it, or none. */
export function dedicationSchema(titles: readonly string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      stated: { type: 'boolean' },
      link: { type: 'string', enum: [...titles, NONE] },
      subject_text: { type: 'string' },
      year: { type: 'string' },
      evidence: { type: 'string' },
    },
    required: ['stated', 'link', 'subject_text', 'year', 'evidence'],
    additionalProperties: false,
  };
}

/** The question about one place: its name and its marked lead, each fenced as data. */
export function dedicationQuestion(name: string, lead: string, titles: readonly string[]): StructuredQuestion {
  return {
    system: leadInstructions(),
    user: `Place: <<<${sanitizePromptData(name)}>>>\n\nLead:\n<<<${lead}>>>`,
    name: 'dedication',
    schema: dedicationSchema(titles),
  };
}

/**
 * A lead as the models read it: the marked prose with what could close its
 * fence or break a line taken out (a lead keeps its paragraphs), cut at
 * `MAX_LEAD_CHARS`, and the titles of the marks left whole in it.
 */
export function promptLead(wikitext: string): { text: string; titles: string[] } {
  const marked = markedLead(wikitext);
  const text = marked.text
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F<>]/g, ' ')
    .slice(0, MAX_LEAD_CHARS);
  return { text, titles: marked.titles.filter((title) => text.includes(`→${title}⟧`)) };
}

/** One field of a parsed answer, or undefined where the answer is no object. */
function fieldOf(answer: unknown, key: string): unknown {
  return answer instanceof Object ? (answer as Record<string, unknown>)[key] : undefined;
}

/**
 * The linked article an answer names as the dedication, or null: an answer
 * that states none, names "none", or names a title the lead does not link is
 * no answer, whatever the shape it was asked in promised.
 */
export function linkNamed(answer: unknown, titles: readonly string[]): string | null {
  const stated = fieldOf(answer, 'stated');
  const link = fieldOf(answer, 'link');
  if (stated !== true || typeof link !== 'string' || link === NONE) return null;
  return titles.includes(link) ? link : null;
}

/**
 * Whether an answer keeps to the shape it was asked in: a link that is one of
 * the lead's titles or "none". One outside it is no answer to keep, and the
 * next pass asks again rather than remembering a "none" the model never said.
 */
function withinShape(answer: unknown, titles: readonly string[]): boolean {
  const link = fieldOf(answer, 'link');
  return link === NONE || (typeof link === 'string' && titles.includes(link));
}

/** The article every model named, or null where any named none or two named different ones. */
export function agreedLink(links: ReadonlyArray<string | null>): string | null {
  const [first] = links;
  return links.length > 1 && first && links.every((link) => link === first) ? first : null;
}

/** Whether a subject is one a dedication read from a lead may name: a person, an occurrence or a group of people. */
export function dedicatedTo(kind: SubjectKind): boolean {
  return kind.human || kind.occurrence || kind.group;
}

/** One kept answer: the revision of the lead it was read from, and the article it named. */
export interface KeptAnswer {
  revid: number;
  link: string | null;
}

/** Where the models' answers are kept, by the article's title and the model. */
export interface LeadAnswerStore {
  /** The kept answers of these articles, by title and then by model. */
  kept(titles: readonly string[]): Promise<Map<string, Map<string, KeptAnswer>>>;
  /** Keeps one answer, replacing the model's earlier answer about the article. */
  keep(title: string, model: string, answer: KeptAnswer): Promise<void>;
}

/** The answers kept in `workbench.lead_dedication_readings`. */
export const leadAnswerStore: LeadAnswerStore = {
  async kept(titles) {
    const { rows } = await pool.query<Pick<LeadDedicationReadingsRow, 'title' | 'model' | 'revid' | 'answer'>>(
      'SELECT title, model, revid, answer FROM workbench.lead_dedication_readings WHERE wiki = $1 AND title = ANY($2::text[])',
      [WIKI, [...titles]],
    );
    const out = new Map<string, Map<string, KeptAnswer>>();
    for (const row of rows) {
      const ofTitle = out.get(row.title) ?? new Map<string, KeptAnswer>();
      // A revision id is an int8, which arrives as a string.
      ofTitle.set(row.model, { revid: Number(row.revid), link: row.answer });
      out.set(row.title, ofTitle);
    }
    return out;
  },
  async keep(title, model, { revid, link }) {
    await pool.query(
      `INSERT INTO workbench.lead_dedication_readings (wiki, title, model, revid, answer, read_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (wiki, title, model) DO UPDATE SET revid = EXCLUDED.revid, answer = EXCLUDED.answer, read_at = EXCLUDED.read_at`,
      [WIKI, title, model, revid, link],
    );
  },
};

/** What the step asks with: the two models, where their answers are kept, and whether the run was cancelled. */
export interface LeadDedicationReader {
  models: readonly DedicationModel[];
  store: LeadAnswerStore;
  isCancelled?: () => boolean;
}

let skipLogged = false;

/** The reader of a run, or null, said once a process, where this deployment lacks a model's key. */
export async function leadDedicationReader(isCancelled?: () => boolean): Promise<LeadDedicationReader | null> {
  const models = await leadDedicationModels();
  if (models) return { models, store: leadAnswerStore, isCancelled };
  if (!skipLogged) {
    console.log('[Commemorates] ANTHROPIC_API_KEY or OPENAI_API_KEY is not set: no dedication is read from a lead');
    skipLogged = true;
  }
  return null;
}

/** One place's question: the lead's article, its revision, and the lead as the models read it. */
interface Asked {
  title: string;
  name: string;
  revid: number;
  text: string;
  titles: string[];
}

/**
 * The article a model names for one lead: its kept answer where that holds the
 * lead's revision, otherwise asked and kept. An answer that cannot be read (a
 * refusal, one cut at the limit) is not kept, so the next pass asks again.
 */
async function linkOf(asked: Asked, model: DedicationModel, kept: KeptAnswer | undefined, store: LeadAnswerStore): Promise<string | null> {
  if (kept?.revid === asked.revid) return kept.link && asked.titles.includes(kept.link) ? kept.link : null;
  const answer = await model.ask(dedicationQuestion(asked.name, asked.text, asked.titles));
  if (answer === null || !withinShape(answer, asked.titles)) return null;
  const link = linkNamed(answer, asked.titles);
  await store.keep(asked.title, model.model, { revid: asked.revid, link });
  return link;
}

/** The article both models name for one lead, or null; a failed call names none and keeps nothing. */
async function agreedOf(asked: Asked, reader: LeadDedicationReader, kept: ReadonlyMap<string, KeptAnswer> | undefined): Promise<string | null> {
  try {
    // Both calls settle before a failure is passed on, so neither is left uncounted.
    const settled = await Promise.allSettled(reader.models.map((model) => linkOf(asked, model, kept?.get(model.model), reader.store)));
    return agreedLink(settled.map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    }));
  } catch (error) {
    if (reader.isCancelled?.()) throw error;
    console.warn(`[Commemorates] the lead of ${asked.title} was not read for a dedication: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Each lead's agreed article, by title, `CONCURRENT_PLACES` leads at a time; a cancelled run stops asking. */
async function agreedLinks(asked: readonly Asked[], reader: LeadDedicationReader): Promise<Map<string, string>> {
  const kept = await reader.store.kept(asked.map((a) => a.title));
  const out = new Map<string, string>();
  let next = 0;
  const work = async () => {
    while (next < asked.length && !reader.isCancelled?.()) {
      const one = asked[next++];
      const link = await agreedOf(one, reader, kept.get(one.title));
      if (link) out.set(one.title, link);
    }
  };
  // Every worker settles before a failure is passed on, so the calls still in flight are counted in the usage logged.
  const settled = await Promise.allSettled(Array.from({ length: Math.min(CONCURRENT_PLACES, asked.length) }, work));
  const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
  return out;
}

/**
 * Each place none of the six steps named a dedication for, given the one
 * both models read alike from its lead, where that names a person, an
 * occurrence or a group (`via: 'lead'`). A place with no English article, a
 * lead that cannot be read or one that links nothing is not asked. `kinds` and
 * `articles` learn the items named; `kindsOf` is the run's reading of what a
 * subject is.
 */
export async function readLeadDedications(
  places: readonly CommemorationPlace[],
  readings: Map<string, PlaceReading>,
  stores: { kinds: Map<string, SubjectKind>; articles: Map<string, string> },
  wiki: CommemorationWiki,
  kindsOf: (items: string[]) => Promise<Map<string, SubjectKind>>,
  reader: LeadDedicationReader,
): Promise<void> {
  const titleOf = new Map(places.flatMap((place) => {
    const title = readings.get(place.qid)?.commemorates ? null : enwikiTitleOf(place.articleUrl);
    return title ? [[place.qid, title] as const] : [];
  }));
  if (!titleOf.size) return;
  const leads: Map<string, Lead> = await wiki.leads([...new Set(titleOf.values())], true);
  const nameOf = new Map(places.flatMap((place) => {
    const title = titleOf.get(place.qid);
    return title ? [[title, place.label ?? title] as const] : [];
  }));
  const asked = [...leads].flatMap(([title, { wikitext, revid }]): Asked[] => {
    const { text, titles } = promptLead(wikitext);
    return titles.length ? [{ title, name: nameOf.get(title) ?? title, revid, text, titles }] : [];
  });
  let agreed: Map<string, string>;
  try {
    agreed = await agreedLinks(asked, reader);
  } finally {
    // A cancelled pass has paid for the calls it made too.
    await Promise.all(reader.models.map((model) => model.logUsage(`Dedications read from ${asked.length} leads`)));
  }
  if (!agreed.size) return;
  const resolved = await wiki.articleItems([...new Set(agreed.values())]);
  const unknown = [...new Set([...resolved.values()].map(({ item }) => item))].filter((item) => !stores.kinds.has(item));
  for (const [item, kind] of await kindsOf(unknown)) stores.kinds.set(item, kind);
  for (const [qid, title] of titleOf) {
    const link = agreed.get(title);
    const item = link ? resolved.get(link)?.item : undefined;
    const kind = item ? stores.kinds.get(item) : undefined;
    // A lead that links the place's own article names no dedication of it.
    if (!link || !item || item === qid || !kind || !dedicatedTo(kind)) continue;
    if (!stores.articles.has(item)) stores.articles.set(item, articleUrl(link));
    const subject = { item, label: kind.label, articleUrl: stores.articles.get(item) ?? null };
    const reading: PlaceReading = { ...(readings.get(qid) ?? { depicts: null }), commemorates: { via: 'lead', subjects: [subject] } };
    // A work raised to someone is no religious statue, whatever holy figure it shows (`PlaceReading.religious`).
    delete reading.religious;
    readings.set(qid, reading);
  }
}
