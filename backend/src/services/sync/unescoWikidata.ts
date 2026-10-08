/**
 * What Wikidata knows about a World Heritage site: its article, and a picture
 * of it that the product is allowed to show.
 *
 * The picture is here rather than in the UNESCO export because of what that
 * export's pictures are. `main_image_url` points at `whc.unesco.org/document/<id>`,
 * and the World Heritage Centre's own terms say those photographs "may not be
 * copied or retransmitted by any means without explicit authorisation" and that
 * a site may "only link to, not replicate" its content — the photographs being
 * third parties' property, licensed to the Centre and to nobody else. So the
 * catalogue links to the property's page, which those terms invite, and takes
 * the picture itself from Wikimedia Commons, whose licences are written to be
 * reused with the author named ([ADR-0043](../../../../docs/decisions/0043-a-picture-we-show-is-one-we-may-show.md)).
 *
 * One query answers both facts because both hang off the same join: the item
 * carrying this site's World Heritage id (P757).
 *
 * **Several items carry one id, and one of them is the property.** Wikidata
 * keeps a number on the property's own item and, often, on something else as
 * well: the place the property is known by (Venice beside "Venice and its
 * Lagoon"), a dedicated item for the inscription with no article of its own, or
 * one building of an ensemble — the Altes Museum has carried Museum Island's 896
 * since 2026-10-01. On 2026-10-03, 107 of the catalogue's sites had a
 * property-tier id on more than one item. So the item is the unit: both facts
 * are read item by item, the item that answers for a site is chosen by the
 * site's own name (`asTheProperty`), and a part does not replace the whole by
 * sorting ahead of it.
 */

import { sparqlQuery, waitMessage, type SparqlBinding, type WaitBudget } from './wikidataUtils.js';
import type { SyncProgress } from './types.js';

const LOG_PREFIX = '[UNESCO Sync]';

/** Which claim answered with the picture. */
export type PictureVia = 'exact' | 'variant' | 'component';

export interface SitePicture {
  /** The Commons file, spelled as Wikidata states it. */
  url: string;
  via: PictureVia;
  /** The World Heritage id that carried it — `166rev`, `1142-01bis`. */
  ref: string;
}

export interface SiteFacts {
  /** The English Wikipedia article about the property itself. */
  article: string | null;
  picture: SitePicture | null;
}

/**
 * A World Heritage id, read as the three things it can be.
 *
 * The list numbers a property `166`, renumbers it `166rev` when the inscription
 * is revised and `292bis` when it is extended, and numbers each component of a
 * serial property `1142-01bis`. Measured over the 7 272 P757 statements on
 * 2026-09-01: 1 302 plain, 282 renumbered, 5 715 components, and 150 that are
 * none of those — `RL/02139`, `sportif`, a Russian sentence. It is a wiki, and
 * anybody may type anything into a field; a value this cannot read is dropped
 * rather than guessed at.
 */
interface WhcRef {
  /** The property's number, as digits, never renormalised: `0166` is not `166`. */
  site: string;
  /** `bis`, `rev`, `ter` … — a later numbering of the same property. */
  variant: string | null;
  /** What follows the dash on a component: `01bis`, `003b 16`. */
  part: string | null;
  raw: string;
}

// Linear by construction: the three parts start with characters that cannot be
// mistaken for each other (a digit, a letter, a dash or blank), so the engine
// never has two ways to read one value.
const WHC_REF = /^(\d+)([a-z]*)(?:[-\s](.*))?$/i;

export function parseWhcRef(value: string): WhcRef | null {
  const match = WHC_REF.exec(value.trim());
  if (!match) return null;
  return {
    site: match[1],
    variant: match[2] ? match[2].toLowerCase() : null,
    part: match[3]?.trim() || null,
    raw: value.trim(),
  };
}

interface Candidate {
  ref: WhcRef;
  /** The Wikidata item that carries the id — absent for a fact read back from a stored row. */
  item: string | null;
  /** The item's English label, which is what tells the property from a part of it. */
  label: string | null;
  /** How many sites link the item: how widely the thing it describes is written about. */
  sitelinks: number;
  article: string | null;
  image: string | null;
}

/** Which of the three things an id is, said once for filing and for the report. */
function tierOf(ref: WhcRef): PictureVia {
  if (ref.part) return 'component';
  return ref.variant ? 'variant' : 'exact';
}

interface SiteCandidates {
  /** The property's own number. */
  exact: Candidate[];
  /** A later numbering of it. */
  variant: Candidate[];
  /** One of its components. */
  component: Candidate[];
}

export interface WorldHeritageIndex {
  bySite: Map<string, SiteCandidates>;
}

/**
 * How two candidates of one tier are ordered.
 *
 * Deterministic, and that is the whole requirement rather than a nicety: the
 * endpoint states no order among an item's claims, so a picture chosen by
 * arrival order would differ between runs — and on a gated source every
 * difference is a proposal a curator has to answer. The order carries no
 * judgement about which component is the better photograph, which is why the
 * report says which ref answered.
 *
 * Components sort by their number first, because that one *is* the source's own
 * ordering: UNESCO numbers a serial property's parts from 001, and the first is
 * as good a stand-in for the whole as the catalogue can state without a person
 * looking. A part whose number cannot be read sorts last rather than first.
 */
function byRef(a: Candidate, b: Candidate): number {
  const number = (c: Candidate) => {
    const digits = /^\d+/.exec(c.ref.part ?? '');
    return digits ? Number(digits[0]) : Number.MAX_SAFE_INTEGER;
  };
  return number(a) - number(b) || a.ref.raw.localeCompare(b.ref.raw);
}

/**
 * Every P757 statement, filed under the property it is about.
 *
 * Built once per run from one query and asked once per record, so the cost is a
 * pass over some seven thousand rows rather than a request per site.
 */
export function indexWorldHeritageFacts(bindings: SparqlBinding[]): WorldHeritageIndex {
  const bySite = new Map<string, SiteCandidates>();

  for (const binding of bindings) {
    const value = binding.whc?.value;
    if (!value) continue;
    const ref = parseWhcRef(value);
    if (!ref) continue;

    let candidates = bySite.get(ref.site);
    if (!candidates) {
      candidates = { exact: [], variant: [], component: [] };
      bySite.set(ref.site, candidates);
    }
    candidates[tierOf(ref)].push({
      ref,
      item: binding.item?.value ?? null,
      label: binding.label?.value ?? null,
      sitelinks: Number(binding.links?.value ?? 0) || 0,
      article: binding.article?.value ?? null,
      image: binding.image?.value ?? null,
    });
  }

  for (const candidates of bySite.values()) {
    candidates.exact.sort(byRef);
    candidates.variant.sort(byRef);
    candidates.component.sort(byRef);
  }

  return { bySite };
}

/** Words that say nothing about which place a name names. */
const NAME_STOPWORDS = new Set([
  'the', 'of', 'and', 'in', 'a', 'an', 'at', 'on', 'with', 'its', 'de', 'la', 'le', 'du', 'des', 'et',
]);

/**
 * A name as the set of words it is made of: markup dropped (the portal writes
 * `<em>Subak</em>` and `<br /><small>…</small>` into names), accents folded,
 * case folded, and the words that name nothing left out.
 */
function nameWords(value: string | null | undefined): Set<string> {
  // Tags cut out by position rather than by pattern: what follows each `<` is
  // dropped up to its `>`, and a `<` that never closes drops nothing.
  const untagged = (value ?? '').split('<')
    .map((piece, i) => (i === 0 || !piece.includes('>') ? piece : piece.slice(piece.indexOf('>') + 1)))
    .join(' ');
  const plain = untagged
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  const words = plain.match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((word) => !NAME_STOPWORDS.has(word)));
}

/**
 * How well an item's label answers to the site's name: how much of the label
 * the name contains, then how much of the two they share.
 *
 * Two measures, in that order, because one alone picks wrongly in both
 * directions. *Covered* is the share of the label's words found in the name: a
 * part named for something else scores low (the Altes Museum under "Museumsinsel
 * (Museum Island), Berlin", Hagia Sophia under "Historic Areas of Istanbul"),
 * while Bridgetown is wholly inside "Historic Bridgetown and its Garrison" where
 * the Garrison Historic Area is not. *Shared* (Jaccard) breaks the tie that
 * leaves: Stonehenge is wholly inside "Stonehenge, Avebury and Associated
 * Sites" and so is the property's own item, which shares all of it.
 */
function nameMatch(label: string | null, site: ReadonlySet<string>): { covered: number; shared: number } {
  const words = nameWords(label);
  if (words.size === 0) return { covered: 0, shared: 0 };
  let common = 0;
  for (const word of words) if (site.has(word)) common += 1;
  return { covered: common / words.size, shared: common / (words.size + site.size - common) };
}

/**
 * The order in which the items carrying one property-tier id answer for the
 * site: the one whose label is the site's name first.
 *
 * Measured on the 107 sites whose id sat on more than one item on 2026-10-03,
 * with each outcome read as a traveller would: the name decides (see
 * `nameMatch`), and where two items answer to it alike — Galápagos Islands
 * twice, Jantar Mantar in Jaipur and in New Delhi — the more widely written
 * about one is the place. The item id last, so the order never depends on the
 * order the query service answered in.
 */
function asTheProperty(site: ReadonlySet<string>): (a: Candidate, b: Candidate) => number {
  return (a, b) => {
    const [ma, mb] = [nameMatch(a.label, site), nameMatch(b.label, site)];
    return mb.covered - ma.covered
      || mb.shared - ma.shared
      || b.sitelinks - a.sitelinks
      || (a.item ?? '').localeCompare(b.item ?? '')
      || byRef(a, b);
  };
}

/** The most widely written about first, for the items that stand in when the property's own is silent. */
function byRenown(a: Candidate, b: Candidate): number {
  return b.sitelinks - a.sitelinks || (a.item ?? '').localeCompare(b.item ?? '') || byRef(a, b);
}

/**
 * How widely written about another carrier of the id has to be before its
 * article stands in for a property whose own item has none.
 *
 * Many properties have a dedicated item with no article — "Venice and its
 * Lagoon", "Palace and Park of Versailles" — and the article a reader wants is
 * the place's: Venice, the Palace of Versailles. So the best-known other
 * carrier answers. But the id also lands on things nobody would send a reader
 * to for the whole: the only other carrier of the Citadel, Ancient City and
 * Fortress Buildings of Derbent is Derbent Lighthouse, on 7 sites. Among the
 * 107 sites measured on 2026-10-03 the least-linked stand-in that was right
 * was the Tijuca Forest at 12, and no article is better than that lighthouse.
 */
export const ARTICLE_STAND_IN_MIN_SITELINKS = 10;

/**
 * What Wikidata states about one site of the catalogue.
 *
 * The two facts are looked for in different places, and the difference is the
 * point. A photograph of one component of a serial property is a photograph of
 * the property — it is what the World Heritage Centre's own page for such a
 * site shows — so the picture may come from a component. An *article* about one
 * component is an article about that component: the reader who follows it from
 * a card about the whole property has been sent to the wrong page. So the
 * article is taken from an item carrying the property's own number,
 * renumberings included.
 *
 * Among those, the item named as the site is named answers first
 * (`asTheProperty`) — for both facts, so the article and the picture are the
 * same item's wherever it states both. Where it has no article, the best-known
 * other carrier stands in if it is known widely enough
 * (`ARTICLE_STAND_IN_MIN_SITELINKS`); where it has no picture, the others are
 * asked in order of renown, and then the components.
 *
 * `name` is the site's name as the portal gives it. Without one — a caller
 * that has only the id — every label matches alike and renown decides.
 */
export function factsForSite(index: WorldHeritageIndex, idNo: string, name?: string | null): SiteFacts {
  const candidates = index.bySite.get(String(idNo).trim());
  if (!candidates) return { article: null, picture: null };

  const site = nameWords(name);
  const property = [candidates.exact, candidates.variant]
    .filter((tier) => tier.length > 0)
    .map((tier) => {
      const [own, ...others] = [...tier].sort(asTheProperty(site));
      return { own, others: others.sort(byRenown) };
    });

  let article: string | null = null;
  for (const { own, others } of property) {
    article = own.article
      ?? others.find((c) => c.article && c.sitelinks >= ARTICLE_STAND_IN_MIN_SITELINKS)?.article
      ?? null;
    if (article) break;
  }

  const pictured = [...property.flatMap(({ own, others }) => [own, ...others]), ...candidates.component]
    .find((c) => c.image);

  return {
    article,
    picture: pictured?.image
      ? { url: pictured.image, via: tierOf(pictured.ref), ref: pictured.ref.raw }
      : null,
  };
}

/**
 * Ask Wikidata about every World Heritage property at once.
 *
 * Through `p:P757/ps:P757` rather than `wdt:P757`, which is the difference
 * between finding Cologne Cathedral and not: `wdt:` exposes only a property's
 * best-ranked statements, and the cathedral's item ranks `292bis` above the
 * `292` this catalogue is keyed by, while the Sydney Opera House carries `166rev`
 * alone. Reading only the best rank cost 366 of 1 272 sites their article link
 * before this, and would have cost the same sites their picture.
 *
 * Grouped by the item and not by the id: several items can carry one id, and
 * a row per id takes the alphabetically first article and picture across all
 * of them — the Altes Museum's for Museum Island, a lighthouse for the citadel
 * of Derbent (#1232). Each row is one item's own article and picture, with the
 * label and the sitelink count `factsForSite` chooses among the items by.
 *
 * `MIN` rather than `SAMPLE` for the same reason `byRef` sorts: an item may
 * carry several pictures, and an arbitrary one of them would change between
 * runs.
 *
 * Answers `null` when Wikidata did not answer, and that is not the same as an
 * index with nothing in it. An empty answer says the properties have no
 * pictures; no answer says nothing about them at all — and a caller that read
 * the two alike would, on a bad afternoon at the query service, take every
 * picture off every site and report the work done. Each caller decides what
 * "did not answer" means for it: the run keeps what the rows already hold, and
 * the repair stops.
 */
export async function fetchWorldHeritageFacts(
  progress: SyncProgress,
  budget: WaitBudget,
): Promise<WorldHeritageIndex | null> {
  const query = `
    SELECT ?item ?whc ?label ?links (MIN(?a) AS ?article) (MIN(?img) AS ?image) WHERE {
      ?item p:P757/ps:P757 ?whc ;
            wikibase:sitelinks ?links .
      OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = "en") }
      OPTIONAL { ?a schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
      OPTIONAL { ?item wdt:P18 ?img . }
    }
    GROUP BY ?item ?whc ?label ?links
  `;

  try {
    const bindings = await sparqlQuery(query, LOG_PREFIX, {
      budget,
      isCancelled: () => progress.cancel,
      onWait: (wait) => {
        progress.statusMessage = waitMessage('Wikidata', wait, budget);
      },
    });
    const index = indexWorldHeritageFacts(bindings);
    console.log(`${LOG_PREFIX} Wikidata answered for ${index.bySite.size} World Heritage properties`);
    return index;
  } catch (error) {
    // A cancellation is the person's, not Wikidata's: the retry loop throws
    // when the run is cancelled mid-wait, and folding that into "did not
    // answer" would tell an admin who pressed Cancel that the query service
    // failed and to try again later.
    if (progress.cancel) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`${LOG_PREFIX} Wikidata did not answer: ${msg}`);
    return null;
  }
}

/** A Wikidata entity URI, or a bare id, as the id: `http://www.wikidata.org/entity/Q42` → `Q42`. */
function itemId(value: string | null): string | null {
  const id = value?.split('/').pop() ?? null;
  return id && /^Q\d+$/.test(id) ? id : null;
}

/** A component reference as compared: case and runs of blanks folded, `1363-061` as `1363-061`. */
const comparableRef = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** How a site's components resolved to their Wikidata items (#1269). */
export interface ComponentResolution {
  /** Every distinct component reference of the site, with its item or none. */
  items: Array<{ ref: string; item: string | null }>;
  /** Component points: one per reference given, two points sharing a reference counted twice. */
  points: number;
  /** Of those, the points whose reference resolved. */
  resolved: number;
  /** References more than one item carries: resolved to none, and named. */
  ambiguous: Array<{ ref: string; items: string[] }>;
}

/**
 * Each component of a serial site, resolved to the Wikidata item whose World
 * Heritage Site ID (P757, at any rank — the index reads `p:P757/ps:P757`)
 * equals its reference. One item resolves it; none leaves it without one; more
 * than one is ambiguous, resolved to none and reported, since choosing would
 * be guessing which place is meant. Only from an index Wikidata answered: one
 * read back from stored rows knows no items, and resolving against it would
 * clear every item the points hold.
 */
export function resolveComponents(index: WorldHeritageIndex, site: string, refs: readonly string[]): ComponentResolution {
  const byRef = new Map<string, Set<string>>();
  for (const candidate of index.bySite.get(site)?.component ?? []) {
    const item = itemId(candidate.item);
    if (!item) continue;
    const key = comparableRef(candidate.ref.raw);
    byRef.set(key, (byRef.get(key) ?? new Set()).add(item));
  }
  const items: ComponentResolution['items'] = [];
  const ambiguous: ComponentResolution['ambiguous'] = [];
  for (const ref of new Set(refs)) {
    const found = [...(byRef.get(comparableRef(ref)) ?? [])].sort();
    if (found.length > 1) ambiguous.push({ ref, items: found });
    items.push({ ref, item: found.length === 1 ? found[0] : null });
  }
  const itemOf = new Map(items.map(one => [one.ref, one.item]));
  return { items, points: refs.length, resolved: refs.filter(ref => itemOf.get(ref) != null).length, ambiguous };
}
