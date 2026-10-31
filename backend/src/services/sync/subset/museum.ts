/**
 * Art Museums' questions answered from the local Wikidata subset (#1460):
 * the works pool, where each work says it is, a candidate venue's details and
 * edges, the museums an entity counts among its parts, what a venue holds,
 * and objects asked for by id. Each answers what its live twin in
 * `museum/queries.ts` or `museum/venueSideQueries.ts` answers, by the
 * spellings in `values.ts`.
 *
 * A work the subset does not keep — no point, and no location, part or
 * collection statement reaching a kept place (ADR-0105) — is in none of these
 * answers, where the live pool collects it and the pipeline counts it as held
 * nowhere. #1460 measures how many such works the live pool holds.
 */

import { foldLabel } from '@tyr/shared/labels';
import { pool } from '../../../db/index.js';
import type { CompactStatement, CompactValue } from '../../dumps/wikidata/compactEntity.js';
import type { EntityDetails, EntityEdges, MuseumPart, PoolWork, RawStatement } from '../museum/queries.js';
import type { VenueHolding, WorkDetails } from '../museum/venueSideQueries.js';
import { MUSEUM_ROOT } from '../wikidataQueries.js';
import { isQid, parseWktPoint, preferredCoordinate, preferredPicture } from '../wikidataUtils.js';
import { BEST, entitiesOf, STANDING, termsOf, type Kept, type Terms } from './entities.js';
import { subsetClassTree } from './kit.js';
import { DISSOLVED_UNKNOWN } from '../museum/venueTest.js';
import { isWorldHeritageCentreUrl } from '@tyr/shared/links';
import {
  articleUrl, bestStatements, hasEnded, itemOf, itemsOf, picturesOf, standingStatements, textOf, wktOf, yearOf,
} from './values.js';

/** Wikidata's *unknown value*, which WDQS writes as a skolem node. */
const isUnknown = (value: CompactValue): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && value.somevalue === true;

/** The kept point of the best statements, folded as every reader folds them; null without one. */
function pointOf(statements: CompactStatement[] | undefined): string | null {
  return bestStatements(statements).map(s => wktOf(s.value)).filter((w): w is string => w !== null && parseWktPoint(w) !== null)
    .reduce<string | null>((kept, next) => preferredCoordinate(kept, next), null);
}

function pictureOf(statements: CompactStatement[] | undefined): string | null {
  return picturesOf(statements).reduce<string | null>((kept, url) => preferredPicture(kept, url), null);
}

/** The makers a work names, labelled, deduped by item and by folded label, never a label that is an id. */
function creatorsOf(statements: CompactStatement[] | undefined, terms: Map<string, Terms>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const maker of itemsOf(bestStatements(statements))) {
    const label = terms.get(maker)?.label;
    if (!label || isQid(label)) continue;
    const keys = [`label:${foldLabel(label)}`, `qid:${maker}`];
    if (keys.some(key => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    out.push(label);
  }
  return out;
}

/** The pool row of a kept work, typed by `type` (the class it was collected under) or the generic one. */
function poolWork(id: string, kept: Kept, terms: Map<string, Terms>, type: { label: string; qid: string | null }): PoolWork {
  const { claims } = kept.entity;
  return {
    qid: id,
    label: terms.get(id)?.label ?? id,
    sitelinks: kept.sitelinks,
    imageUrl: pictureOf(claims.P18),
    creators: creatorsOf(claims.P170, terms),
    year: bestStatements(claims.P571).map(s => yearOf(s.value)).find(year => year !== null) ?? null,
    type: type.label,
    typeQid: type.qid,
  };
}

/** Labels of the works and of everything their pool rows name: makers and the given classes. */
async function poolTerms(kept: Map<string, Kept>, more: string[] = []): Promise<Map<string, Terms>> {
  const makers = [...kept.values()].flatMap(({ entity }) => itemsOf(bestStatements(entity.claims.P170)));
  return termsOf([...kept.keys(), ...makers, ...more]);
}

/**
 * The works of any of `classes` (best-rank P31) with at least `minSitelinks`
 * sitelinks of any site, as the live banded and class pools collect them. A
 * broad root passes its own type (`root`); a batch of narrow classes types
 * each work by the first of its classes in the batch, by label, or as an
 * artwork where that class has none.
 */
export async function subsetWorkPool(
  classes: string[], minSitelinks: number, root: { type: string; qid: string } | null,
): Promise<PoolWork[]> {
  if (!classes.length) return [];
  const result = await pool.query<{ subject: string }>(
    `SELECT DISTINCT c.subject FROM wikidata_claims c JOIN wikidata_entities e ON e.id = c.subject
      WHERE c.property = 'P31' AND c.value_item = ANY($1::text[]) AND c.rank >= 0 AND ${BEST('c')}
        AND e.sitelink_count >= $2`,
    [classes, minSitelinks],
  );
  const kept = await entitiesOf(result.rows.map(row => row.subject));
  const terms = await poolTerms(kept, root ? [] : classes);
  const asked = new Set(classes);
  return [...kept].map(([id, work]) => {
    if (root) return poolWork(id, work, terms, { label: root.type, qid: root.qid });
    const cls = itemsOf(bestStatements(work.entity.claims.P31)).find(qid => asked.has(qid)) ?? null;
    const label = cls ? terms.get(cls)?.label : null;
    return poolWork(id, work, terms, { label: label && !isQid(label) ? label : 'artwork', qid: cls });
  });
}

/**
 * Where each work says it is: its collection and location statements at every
 * rank but deprecated, an ended one dropped, an unknown value kept with no
 * venue, as `fetchVenueStatements` answers.
 */
export async function subsetVenueStatements(works: string[]): Promise<RawStatement[]> {
  const kept = await entitiesOf(works);
  return works.flatMap(work => {
    const claims = kept.get(work)?.entity.claims ?? {};
    return (['P195', 'P276'] as const).flatMap(property =>
      (claims[property] ?? []).flatMap(statement => venueStatement(work, property, statement)));
  });
}

/** One statement read as a venue statement, or none: deprecated, ended, or naming no item. */
function venueStatement(work: string, property: 'P195' | 'P276', statement: CompactStatement): RawStatement[] {
  if (statement.rank === 'deprecated' || hasEnded(statement)) return [];
  const unknown = isUnknown(statement.value);
  const venue = itemOf(statement.value);
  if (!unknown && !venue) return [];
  return [{ work, venue: unknown ? null : venue, property, rank: statement.rank === 'preferred' ? 'preferred' : 'normal' }];
}

/**
 * A dissolution date as WDQS writes a date: no sign, an unknown month or day
 * as the first; an unknown value as a dissolution of unknown date, and no
 * value as none, since `wdt:` binds the one and not the other.
 */
export function dissolvedOf(statements: CompactStatement[] | undefined): string | null {
  for (const statement of bestStatements(statements)) {
    if (isUnknown(statement.value)) return DISSOLVED_UNKNOWN;
    const time = (statement.value as { time?: string } | null)?.time;
    if (typeof time === 'string') return time.replace(/^\+/, '').replace(/-00-00T/, '-01-01T').replace(/-00T/, '-01T');
  }
  return null;
}

/** A candidate venue's single-valued facts, as `fetchEntityDetails` answers before its recount. */
export async function subsetEntityDetails(qids: string[]): Promise<Map<string, EntityDetails>> {
  const kept = await entitiesOf(qids);
  const countries = [...kept.values()].flatMap(({ entity }) => itemsOf(bestStatements(entity.claims.P17)).slice(0, 1));
  const terms = await termsOf([...kept.keys(), ...countries]);
  const out = new Map<string, EntityDetails>();
  for (const [id, { sitelinks, entity }] of kept) {
    const { claims } = entity;
    const at = (() => { const wkt = pointOf(claims.P625); return wkt ? parseWktPoint(wkt) : null; })();
    const country = itemsOf(bestStatements(claims.P17))[0];
    out.set(id, {
      qid: id,
      label: terms.get(id)?.label ?? id,
      description: terms.get(id)?.description ?? null,
      lat: at?.lat ?? null,
      lon: at?.lon ?? null,
      countryLabel: country ? terms.get(country)?.label ?? null : null,
      imageUrl: pictureOf(claims.P18),
      itemPictures: picturesOf(claims.P18),
      website: bestStatements(claims.P856).map(s => textOf(s.value)).find(url => url && !isWorldHeritageCentreUrl(url)) ?? null,
      articleUrl: entity.sitelinks.enwiki ? articleUrl(entity.sitelinks.enwiki) : null,
      sitelinks,
      dissolved: dissolvedOf(claims.P576),
    });
  }
  return out;
}

/** Classes, what it is part of (best rank, unfiltered) and where it stands, as `fetchEntityEdges` answers. */
export async function subsetEntityEdges(qids: string[]): Promise<Map<string, EntityEdges>> {
  const kept = await entitiesOf(qids);
  const out = new Map<string, EntityEdges>();
  for (const qid of qids) {
    const claims = kept.get(qid)?.entity.claims ?? {};
    out.set(qid, {
      classes: itemsOf(bestStatements(claims.P31)),
      parents: itemsOf(bestStatements(claims.P361)),
      locations: itemsOf(standingStatements(claims.P276)),
    });
  }
  return out;
}

/** The museums each entity counts among its parts, with their points, as `fetchMuseumParts` answers. */
export async function subsetMuseumParts(qids: string[]): Promise<Map<string, MuseumPart[]>> {
  const out = new Map<string, MuseumPart[]>(qids.map(qid => [qid, []]));
  if (!qids.length) return out;
  const candidates = await partCandidates(qids);
  const parts = await entitiesOf([...new Set([...candidates.values()].flatMap(set => [...set]))]);
  const museums = await subsetClassTree(MUSEUM_ROOT);
  const museumAt = (part: string) => {
    const claims = parts.get(part)?.entity.claims;
    if (!claims || !itemsOf(bestStatements(claims.P31)).some(cls => museums.has(cls))) return null;
    // A dissolved part is no house any more (#1617): Frick Madison closed in 2024.
    if (dissolvedOf(claims.P576)) return null;
    const wkt = pointOf(claims.P625);
    return wkt ? parseWktPoint(wkt) : null;
  };
  for (const [whole, set] of candidates) {
    for (const part of set) {
      const at = museumAt(part);
      if (at) out.get(whole)!.push({ qid: part, lat: at.lat, lon: at.lon });
    }
  }
  return out;
}

/** What each entity lists as its parts (best P527), and what names it as its whole (best P361). */
async function partCandidates(qids: string[]): Promise<Map<string, Set<string>>> {
  const candidates = new Map<string, Set<string>>(qids.map(qid => [qid, new Set<string>()]));
  // The parts that stand today (#1617): a listing with an end time is a house the whole has left.
  for (const [id, { entity }] of await entitiesOf(qids)) {
    for (const part of itemsOf(standingStatements(entity.claims.P527))) candidates.get(id)!.add(part);
  }
  const reverse = await pool.query<{ subject: string; value_item: string }>(
    `SELECT c.subject, c.value_item FROM wikidata_claims c
      WHERE c.property = 'P361' AND c.value_item = ANY($1::text[]) AND ${STANDING('c')} AND ${BEST('c')}`,
    [qids],
  );
  for (const row of reverse.rows) candidates.get(row.value_item)?.add(row.subject);
  return candidates;
}

/**
 * What each venue holds by a collection or location statement that still
 * holds (no end time), deprecated left out, at or above `floor` sitelinks of
 * any site, as `fetchVenueHoldings` collects before its recount.
 */
export async function subsetVenueHoldings(venues: string[], floor: number): Promise<VenueHolding[]> {
  if (!venues.length) return [];
  const result = await pool.query<{ work: string; venue: string; property: 'P195' | 'P276'; sitelinks: number }>(
    `SELECT DISTINCT c.subject AS work, c.value_item AS venue, c.property, e.sitelink_count AS sitelinks
       FROM wikidata_claims c JOIN wikidata_entities e ON e.id = c.subject
      WHERE c.property IN ('P195', 'P276') AND c.value_item = ANY($1::text[]) AND ${STANDING('c')}
        AND e.sitelink_count >= $2`,
    [venues, floor],
  );
  return result.rows;
}

/**
 * Objects asked for by id: the pool's row and every class each carries with
 * its label, as `fetchWorksByIds` reads them before it types each object.
 */
export async function subsetWorksByIds(qids: string[]): Promise<Map<string, WorkDetails>> {
  const kept = await entitiesOf(qids);
  const classesOf = new Map([...kept].map(([id, { entity }]) => [id, itemsOf(bestStatements(entity.claims.P31))]));
  const terms = await poolTerms(kept, [...classesOf.values()].flat());
  const out = new Map<string, WorkDetails>();
  for (const [id, work] of kept) {
    const classes = new Map((classesOf.get(id) ?? []).map(cls => {
      const label = terms.get(cls)?.label;
      return [cls, label && !isQid(label) ? label : cls] as [string, string];
    }));
    out.set(id, { work: poolWork(id, work, terms, { label: 'object', qid: null }), classes });
  }
  return out;
}
