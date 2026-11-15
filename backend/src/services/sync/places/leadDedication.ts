/**
 * The seventh step of the commemorates reading (#2472, ADR-0201): a
 * dedication stated only in the lead of a place's Wikipedia article.
 * The Shaheed Minar in Dhaka carries no *commemorates* statement and no
 * memorials category; its English lead says it was "established to
 * commemorate those killed during the Bengali language movement".
 *
 * The English lead is read first. Where it names no dedication, or the place
 * has no English article, the lead of the place's article in its country's
 * language is read the same way (`ownLanguage.ts`, #2491, ADR-0208): the
 * Democracy Monument's English lead states none, its Thai one that it was
 * raised to commemorate the Siamese revolution of 1932. The instructions stay
 * the measured English ones, and the question names the lead's language. A
 * place whose English lead a failed fetch or call, or a model's unreadable
 * answer, left unread is not read in another language on that pass, so its
 * English lead stays the first answer; one a host refused to serve counts as
 * no English lead.
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
 * is kept per edition and article revision (`workbench.lead_dedication_readings`): a model
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
import type { OwnArticle } from './ownLanguage.js';
import { markedLead } from './warNarrowing.js';

/** The link of an answer that names none. */
const NONE = 'none';

/**
 * The most of a lead a model reads, in characters: the measured leads took
 * about 1,400 tokens of Claude's input, and a lead several times as long is
 * still read whole.
 */
const MAX_LEAD_CHARS = 12_000;

/** An edition a lead is read on: its sitelink key, its host, and the language a model is told. */
interface Edition {
  wiki: string;
  host: string;
  /** The Wikimedia language code the question names; null for English, whose question is the one measured. */
  language: string | null;
}

/** English Wikipedia, read first. */
const ENGLISH: Edition = { wiki: 'enwiki', host: 'en', language: null };

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

/** A Wikimedia language code as a model is told it: its English name and the code, `Russian (ru)`, or the code alone where no name is known. */
export function languageName(code: string): string {
  const tag = sanitizePromptData(code);
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' }).of(tag);
    return name ? `${name} (${tag})` : tag;
  } catch {
    // A code no locale tag spells: a Wikimedia code is any string an editor wrote.
    return tag;
  }
}

/**
 * The question about one place: its name and its marked lead, each fenced as
 * data, and, for a lead not in English, the lead's language (#2491); the
 * instructions are the measured English ones whatever the lead's language.
 */
export function dedicationQuestion(name: string, lead: string, titles: readonly string[], language: string | null = null): StructuredQuestion {
  const told = language ? `\n\nLanguage of the lead: <<<${languageName(language)}>>>` : '';
  return {
    system: leadInstructions(),
    user: `Place: <<<${sanitizePromptData(name)}>>>${told}\n\nLead:\n<<<${lead}>>>`,
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

/** Where the models' answers are kept, by the edition, the article's title and the model. */
export interface LeadAnswerStore {
  /** The kept answers of these articles of the edition `wiki`, by title and then by model. */
  kept(wiki: string, titles: readonly string[]): Promise<Map<string, Map<string, KeptAnswer>>>;
  /** Keeps one answer, replacing the model's earlier answer about the article of that edition. */
  keep(wiki: string, title: string, model: string, answer: KeptAnswer): Promise<void>;
}

/** The answers kept in `workbench.lead_dedication_readings`, keyed by the edition (`enwiki`, `ruwiki`). */
export const leadAnswerStore: LeadAnswerStore = {
  async kept(wiki, titles) {
    const { rows } = await pool.query<Pick<LeadDedicationReadingsRow, 'title' | 'model' | 'revid' | 'answer'>>(
      'SELECT title, model, revid, answer FROM workbench.lead_dedication_readings WHERE wiki = $1 AND title = ANY($2::text[])',
      [wiki, [...titles]],
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
  async keep(wiki, title, model, { revid, link }) {
    await pool.query(
      `INSERT INTO workbench.lead_dedication_readings (wiki, title, model, revid, answer, read_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (wiki, title, model) DO UPDATE SET revid = EXCLUDED.revid, answer = EXCLUDED.answer, read_at = EXCLUDED.read_at`,
      [wiki, title, model, revid, link],
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

/** One place's question: the lead's article, its revision, the lead as the models read it, and its edition. */
interface Asked {
  title: string;
  name: string;
  revid: number;
  text: string;
  titles: string[];
  wiki: string;
  language: string | null;
}

/**
 * The article a model names for one lead: its kept answer where that holds the
 * lead's revision, otherwise asked and kept. An answer that cannot be read (a
 * refusal, one cut at the limit, one outside the asked shape) is not kept and
 * leaves the lead unread, so the next pass asks again and no other lead of the
 * place is read in its stead on this one.
 */
async function linkOf(
  asked: Asked, model: DedicationModel, kept: KeptAnswer | undefined, store: LeadAnswerStore,
): Promise<{ link: string | null; read: boolean }> {
  if (kept?.revid === asked.revid) return { link: kept.link && asked.titles.includes(kept.link) ? kept.link : null, read: true };
  const answer = await model.ask(dedicationQuestion(asked.name, asked.text, asked.titles, asked.language));
  if (answer === null || !withinShape(answer, asked.titles)) return { link: null, read: false };
  const link = linkNamed(answer, asked.titles);
  await store.keep(asked.wiki, asked.title, model.model, { revid: asked.revid, link });
  return { link, read: true };
}

/** The article both models name for one lead, or null; a failed call or an unreadable answer names none and leaves the lead unread. */
async function agreedOf(
  asked: Asked, reader: LeadDedicationReader, kept: ReadonlyMap<string, KeptAnswer> | undefined,
): Promise<{ link: string | null; read: boolean }> {
  try {
    // Both calls settle before a failure is passed on, so neither is left uncounted.
    const settled = await Promise.allSettled(reader.models.map((model) => linkOf(asked, model, kept?.get(model.model), reader.store)));
    const answers = settled.map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
    if (answers.some((answer) => !answer.read)) return { link: null, read: false };
    return { link: agreedLink(answers.map((answer) => answer.link)), read: true };
  } catch (error) {
    if (reader.isCancelled?.()) throw error;
    console.warn(`[Commemorates] the lead of ${asked.title} (${asked.wiki}) was not read for a dedication: ${error instanceof Error ? error.message : String(error)}`);
    return { link: null, read: false };
  }
}

/**
 * Each lead's agreed article, by title, and the titles a failed call left
 * unread, `CONCURRENT_PLACES` leads at a time; a cancelled run stops asking.
 */
async function agreedLinks(
  asked: readonly Asked[], reader: LeadDedicationReader, wiki: string,
): Promise<{ agreed: Map<string, string>; unread: Set<string> }> {
  const kept = await reader.store.kept(wiki, asked.map((a) => a.title));
  const agreed = new Map<string, string>();
  const unread = new Set<string>();
  let next = 0;
  const work = async () => {
    while (next < asked.length && !reader.isCancelled?.()) {
      const one = asked[next++];
      const { link, read } = await agreedOf(one, reader, kept.get(one.title));
      if (link) agreed.set(one.title, link);
      if (!read) unread.add(one.title);
    }
  };
  // Every worker settles before a failure is passed on, so the calls still in flight are counted in the usage logged.
  const settled = await Promise.allSettled(Array.from({ length: Math.min(CONCURRENT_PLACES, asked.length) }, work));
  const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
  return { agreed, unread };
}

/** What the step reads of Wikidata through the run's door. */
export interface LeadWikidata {
  /** The run's reading of what a subject is. */
  kindsOf(items: string[]): Promise<Map<string, SubjectKind>>;
  /** Each place's article in its country's language, where it has one that is not English (`ownLanguage.ts`). */
  ownArticles(qids: string[]): Promise<Map<string, OwnArticle>>;
  /** Each item's English Wikipedia article, as `fetchEnglishArticles` answers. */
  englishArticles(items: string[]): Promise<Map<string, string>>;
}

/** What every edition's reading of one pass shares, and how many leads it asked about. */
interface Pass {
  places: ReadonlyMap<string, CommemorationPlace>;
  readings: Map<string, PlaceReading>;
  stores: { kinds: Map<string, SubjectKind>; articles: Map<string, string> };
  wiki: CommemorationWiki;
  wikidata: LeadWikidata;
  reader: LeadDedicationReader;
  asked: number;
}

/** What the run's reading says each item is, and, off English Wikipedia, each item's English article, where the pass does not know them yet. */
async function learnItems(items: readonly string[], english: boolean, { stores, wikidata }: Pass): Promise<void> {
  for (const [item, kind] of await wikidata.kindsOf(items.filter((item) => !stores.kinds.has(item)))) stores.kinds.set(item, kind);
  const lacking = english ? [] : items.filter((item) => !stores.articles.has(item));
  if (lacking.length) for (const [item, url] of await wikidata.englishArticles(lacking)) stores.articles.set(item, url);
}

/**
 * The agreed articles of one edition written onto their places: each resolved
 * to its item on that edition, typed, and given the item's English article
 * (the agreed English title itself on English Wikipedia).
 */
async function writeAgreed(edition: Edition, titleOf: ReadonlyMap<string, string>, agreed: ReadonlyMap<string, string>, pass: Pass): Promise<void> {
  const { stores, wiki, readings } = pass;
  const english = edition.wiki === ENGLISH.wiki;
  const links = [...new Set(agreed.values())];
  const resolved = english ? await wiki.articleItems(links) : await wiki.articleItems(links, edition.host);
  await learnItems([...new Set([...resolved.values()].map(({ item }) => item))], english, pass);
  for (const [qid, title] of titleOf) {
    const link = agreed.get(title);
    const item = link ? resolved.get(link)?.item : undefined;
    const kind = item ? stores.kinds.get(item) : undefined;
    // A lead that links the place's own article names no dedication of it.
    if (!link || !item || item === qid || !kind || !dedicatedTo(kind)) continue;
    if (english && !stores.articles.has(item)) stores.articles.set(item, articleUrl(link));
    const subject = { item, label: kind.label, articleUrl: stores.articles.get(item) ?? null };
    const reading: PlaceReading = { ...(readings.get(qid) ?? { depicts: null }), commemorates: { via: 'lead', subjects: [subject] } };
    // A work raised to someone is no religious statue, whatever holy figure it shows (`PlaceReading.religious`).
    delete reading.religious;
    readings.set(qid, reading);
  }
}

/**
 * The leads of one edition, by the place each is the article of, read and
 * written: the places whose lead a failed fetch or call, or a model's
 * unreadable answer, left unread are answered.
 */
async function readEdition(edition: Edition, titleOf: ReadonlyMap<string, string>, pass: Pass): Promise<Set<string>> {
  const english = edition.wiki === ENGLISH.wiki;
  const titles = [...new Set(titleOf.values())];
  const leads = english ? await pass.wiki.leads(titles, true) : await pass.wiki.leads(titles, true, edition.host);
  const nameOf = new Map([...titleOf].map(([qid, title]) => [title, pass.places.get(qid)?.label ?? title] as const));
  const asked = [...leads].flatMap(([title, { wikitext, revid }]): Asked[] => {
    const { text, titles: linked } = promptLead(wikitext);
    return linked.length ? [{ title, name: nameOf.get(title) ?? title, revid, text, titles: linked, wiki: edition.wiki, language: edition.language }] : [];
  });
  pass.asked += asked.length;
  const { agreed, unread } = await agreedLinks(asked, pass.reader, edition.wiki);
  if (agreed.size) await writeAgreed(edition, titleOf, agreed, pass);
  // A lead whose fetch failed is unread as one whose call failed is; a lead a host refused is none.
  const failed = leads.failed ?? new Set<string>();
  return new Set([...titleOf].filter(([, title]) => unread.has(title) || failed.has(title)).map(([qid]) => qid));
}

/** The own-language articles grouped by edition, the editions in their sitelink keys' order, each by place. */
function byEdition(own: ReadonlyMap<string, OwnArticle>): Array<[Edition, Map<string, string>]> {
  const out = new Map<string, [Edition, Map<string, string>]>();
  for (const [qid, { wiki, host, language, title }] of own) {
    const entry = out.get(wiki) ?? [{ wiki, host, language }, new Map<string, string>()];
    entry[1].set(qid, title);
    out.set(wiki, entry);
  }
  return [...out.keys()].sort().map((wiki) => out.get(wiki)!);
}

/**
 * Each place none of the six steps named a dedication for, given the one
 * both models read alike from its lead, where that names a person, an
 * occurrence or a group (`via: 'lead'`): its English lead first, then, where
 * that names none or there is none, the lead in its country's language. A
 * lead that cannot be read or one that links nothing is not asked. `kinds`
 * and `articles` learn the items named; `wikidata` is the run's door to what
 * a subject is, to a place's own-language article and to an item's English
 * article.
 */
export async function readLeadDedications(
  places: readonly CommemorationPlace[],
  readings: Map<string, PlaceReading>,
  stores: { kinds: Map<string, SubjectKind>; articles: Map<string, string> },
  wiki: CommemorationWiki,
  wikidata: LeadWikidata,
  reader: LeadDedicationReader,
): Promise<void> {
  const pass: Pass = { places: new Map(places.map((place) => [place.qid, place])), readings, stores, wiki, wikidata, reader, asked: 0 };
  const unanswered = (qid: string) => !readings.get(qid)?.commemorates;
  const englishTitles = new Map(places.flatMap((place) => {
    const title = unanswered(place.qid) ? enwikiTitleOf(place.articleUrl) : null;
    return title ? [[place.qid, title] as const] : [];
  }));
  try {
    const unread = englishTitles.size ? await readEdition(ENGLISH, englishTitles, pass) : new Set<string>();
    const rest = [...pass.places.keys()].filter((qid) => unanswered(qid) && !unread.has(qid));
    if (!rest.length || reader.isCancelled?.()) return;
    for (const [edition, titleOf] of byEdition(await wikidata.ownArticles(rest))) {
      if (reader.isCancelled?.()) return;
      await readEdition(edition, titleOf, pass);
    }
  } finally {
    // A cancelled pass has paid for the calls it made too.
    await Promise.all(reader.models.map((model) => model.logUsage(`Dedications read from ${pass.asked} leads`)));
  }
}
