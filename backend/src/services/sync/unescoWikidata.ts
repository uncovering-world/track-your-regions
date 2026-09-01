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
 * arrival order would differ between runs — and on a gated category every
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

/** The first candidate of these that states the fact, or nothing. */
function firstStating<T>(tiers: Candidate[][], read: (c: Candidate) => T | null): { value: T; from: Candidate } | null {
  for (const tier of tiers) {
    for (const candidate of tier) {
      const value = read(candidate);
      if (value) return { value, from: candidate };
    }
  }
  return null;
}

/**
 * What Wikidata states about one site of the catalogue.
 *
 * The two facts are looked for in different places, and the difference is the
 * point. A photograph of one component of a serial property is a photograph of
 * the property — it is what the World Heritage Centre's own page for such a
 * site shows — so the picture may come from a component. An *article* about one
 * component is an article about that component: the reader who follows it from
 * a card about the whole property has been sent to the wrong page. So the
 * article is taken from the property's own item only, renumberings included.
 */
export function factsForSite(index: WorldHeritageIndex, idNo: string): SiteFacts {
  const candidates = index.bySite.get(String(idNo).trim());
  if (!candidates) return { article: null, picture: null };

  const property = [candidates.exact, candidates.variant];
  const article = firstStating(property, (c) => c.article);
  const picture = firstStating([...property, candidates.component], (c) => c.image);

  return {
    article: article?.value ?? null,
    picture: picture
      ? {
        url: picture.value,
        via: tierOf(picture.from.ref),
        ref: picture.from.ref.raw,
      }
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
    SELECT ?whc (MIN(?a) AS ?article) (MIN(?img) AS ?image) WHERE {
      ?item p:P757/ps:P757 ?whc .
      OPTIONAL { ?a schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
      OPTIONAL { ?item wdt:P18 ?img . }
    }
    GROUP BY ?whc
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
