/**
 * Public Art's questions answered from the local Wikidata subset (#1459):
 * the pool of a class or of ids with the facts each pool row carries, the
 * multi-valued facts about entities, and what their containers are. Each
 * answers what its live twin in `publicArt/queries.ts` answers, read from the
 * kept entities (ADR-0105) by the spellings in `values.ts`.
 *
 * A multi-valued fact the pool row carries one of — the country, the
 * website, the year — is the first best statement's, where the live answer is
 * whichever row came first; the picture and the point are folded over every
 * best statement by the rule every reader keeps (`preferredPicture`,
 * `preferredCoordinate`), as the live parse folds them over its rows.
 */

import { foldLabel } from '@tyr/shared/labels';
import { pool } from '../../../db/index.js';
import type { CompactEntity } from '../../dumps/wikidata/compactEntity.js';
import type { ContainerFacts, EntityFacts, PoolEntity } from '../publicArt/queries.js';
import { LABEL_LANGS, parseWktPoint, preferredCoordinate, preferredPicture } from '../wikidataUtils.js';
import {
  articleUrl, bestStatements, itemsOf, pictureUrl, standingStatements, textOf, wktOf, yearOf,
} from './values.js';

const LANGUAGES = LABEL_LANGS.split(',');

/** Claim `c` is one of its subject's best statements of its property: none outranks it. */
const BEST = (alias: string) => `NOT EXISTS (
  SELECT 1 FROM wikidata_claims h WHERE h.subject = ${alias}.subject AND h.property = ${alias}.property AND h.rank > ${alias}.rank)`;

interface Kept {
  sitelinks: number;
  entity: CompactEntity;
}

async function entitiesOf(ids: string[]): Promise<Map<string, Kept>> {
  if (!ids.length) return new Map();
  const result = await pool.query<{ id: string; sitelink_count: number; entity: CompactEntity }>(
    'SELECT id, sitelink_count, entity FROM wikidata_entities WHERE id = ANY($1::text[])',
    [ids],
  );
  return new Map(result.rows.map(row => [row.id, { sitelinks: row.sitelink_count, entity: row.entity }]));
}

interface Terms {
  label: string | null;
  description: string | null;
}

/**
 * Each entity's label and description in the first of the label service's
 * languages that has one, as `SERVICE wikibase:label` answers; kept entities
 * and the labels ring both have theirs in `wikidata_labels`.
 */
export async function termsOf(ids: string[]): Promise<Map<string, Terms>> {
  const out = new Map<string, Terms>();
  if (!ids.length) return out;
  const result = await pool.query<{ id: string; language: string; label: string | null; description: string | null }>(
    'SELECT id, language, label, description FROM wikidata_labels WHERE id = ANY($1::text[]) AND language = ANY($2::text[])',
    [ids, LANGUAGES],
  );
  const byId = new Map<string, Map<string, { label: string | null; description: string | null }>>();
  for (const row of result.rows) {
    if (!byId.has(row.id)) byId.set(row.id, new Map());
    byId.get(row.id)!.set(row.language, row);
  }
  for (const [id, languages] of byId) {
    const first = (field: 'label' | 'description') =>
      LANGUAGES.map(language => languages.get(language)?.[field] ?? null).find(value => value !== null) ?? null;
    out.set(id, { label: first('label'), description: first('description') });
  }
  return out;
}

/** The pool row's facts about one kept entity; null for one with no point where a point is required. */
function poolEntity(id: string, kept: Kept, terms: Map<string, Terms>, placeless: boolean): PoolEntity | null {
  const { claims } = kept.entity;
  const wkt = bestStatements(claims.P625).map(s => wktOf(s.value)).filter((w): w is string => w !== null && parseWktPoint(w) !== null)
    .reduce<string | null>((kept, next) => preferredCoordinate(kept, next), null);
  if (!wkt && !placeless) return null;
  const picture = bestStatements(claims.P18).map(s => textOf(s.value)).filter((f): f is string => f !== null)
    .reduce<string | null>((kept, file) => preferredPicture(kept, pictureUrl(file)), null);
  const at = wkt ? parseWktPoint(wkt) : null;
  const country = itemsOf(bestStatements(claims.P17))[0];
  const enwiki = kept.entity.sitelinks.enwiki;
  return {
    qid: id,
    label: terms.get(id)?.label ?? id,
    description: terms.get(id)?.description ?? null,
    lat: at?.lat ?? null,
    lon: at?.lon ?? null,
    onEarth: !wkt?.startsWith('<'),
    imageUrl: picture,
    sitelinks: kept.sitelinks,
    countryLabel: country ? terms.get(country)?.label ?? null : null,
    articleUrl: enwiki ? articleUrl(enwiki) : null,
    website: bestStatements(claims.P856).map(s => textOf(s.value)).find(Boolean) ?? null,
    year: bestStatements(claims.P571).map(s => yearOf(s.value)).find(year => year !== null) ?? null,
  };
}

async function poolOf(ids: string[], placeless: boolean): Promise<PoolEntity[]> {
  const kept = await entitiesOf(ids);
  const countries = [...kept.values()].flatMap(({ entity }) => itemsOf(bestStatements(entity.claims.P17)).slice(0, 1));
  const terms = await termsOf([...kept.keys(), ...countries]);
  return [...kept].map(([id, entity]) => poolEntity(id, entity, terms, placeless)).filter((e): e is PoolEntity => e !== null);
}

/**
 * The entities of any of `classes` (best-rank P31) with a point and at least
 * `minSitelinks` sitelinks of any site, as the live class and broad pools
 * collect them before the Wikipedia editions are counted.
 */
export async function subsetPoolOfClasses(classes: string[], minSitelinks: number): Promise<PoolEntity[]> {
  if (!classes.length) return [];
  const result = await pool.query<{ subject: string }>(
    `SELECT DISTINCT c.subject FROM wikidata_claims c
       JOIN wikidata_entities e ON e.id = c.subject
      WHERE c.property = 'P31' AND c.value_item = ANY($1::text[]) AND c.rank >= 0 AND ${BEST('c')}
        AND e.sitelink_count >= $2
        AND EXISTS (SELECT 1 FROM wikidata_claims p
                     WHERE p.subject = c.subject AND p.property = 'P625' AND p.rank >= 0 AND p.value ? 'latitude' AND ${BEST('p')})`,
    [classes, minSitelinks],
  );
  return poolOf(result.rows.map(row => row.subject), false);
}

/**
 * The pool row of each entity asked for by id, with no class, floor or point
 * required. Only an entity the subset kept is answered: an admitted row that
 * lost its point and every place statement is outside the subset's scope and
 * goes to the sweep, where the live question would let the rule refuse it by
 * name.
 */
export async function subsetPoolOfIds(ids: string[]): Promise<PoolEntity[]> {
  return poolOf(ids, true);
}

/** The multi-valued facts about each entity, as `fetchEntityFacts` answers. */
export async function subsetEntityFacts(ids: string[]): Promise<Map<string, EntityFacts>> {
  const kept = await entitiesOf(ids);
  const makers = [...kept.values()].flatMap(({ entity }) => itemsOf(bestStatements(entity.claims.P170)));
  const terms = await termsOf(makers);
  const out = new Map<string, EntityFacts>();
  for (const id of ids) {
    const claims = kept.get(id)?.entity.claims ?? {};
    const seen = new Set<string>();
    const creators: string[] = [];
    for (const maker of itemsOf(bestStatements(claims.P170))) {
      const label = terms.get(maker)?.label;
      if (!label || seen.has(foldLabel(label))) continue;
      seen.add(foldLabel(label));
      creators.push(label);
    }
    out.set(id, {
      classes: itemsOf(bestStatements(claims.P31)),
      locations: itemsOf(standingStatements(claims.P276)),
      parents: itemsOf(standingStatements(claims.P361)),
      collections: itemsOf(standingStatements(claims.P195)),
      creators,
    });
  }
  return out;
}

/** What each container is called, is, and stands in or is part of, as `fetchContainerFacts` answers. */
export async function subsetContainerFacts(ids: string[]): Promise<Map<string, ContainerFacts>> {
  const kept = await entitiesOf(ids);
  const terms = await termsOf(ids);
  const out = new Map<string, ContainerFacts>();
  for (const [id, { entity }] of kept) {
    const { claims } = entity;
    out.set(id, {
      label: terms.get(id)?.label ?? id,
      classes: itemsOf(bestStatements(claims.P31)),
      parents: [...itemsOf(standingStatements(claims.P276)), ...itemsOf(standingStatements(claims.P361))],
    });
  }
  return out;
}

