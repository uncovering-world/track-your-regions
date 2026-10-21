/**
 * Public Art's questions answered from the local Wikidata subset (#1459):
 * the pool of a class or of ids with the facts each pool row carries, the
 * multi-valued facts about entities, and what their containers are. Each
 * answers what its live twin in `publicArt/queries.ts` answers, read from the
 * kept entities (ADR-0105) by the spellings in `values.ts`.
 *
 * A multi-valued fact the pool row carries one of — the website, the year —
 * is the first best statement's, where the live answer is whichever row came
 * first; the picture and the point are folded over every best statement by
 * the rule every reader keeps (`preferredPicture`, `preferredCoordinate`), as
 * the live parse folds them over its rows; the country is `countryOfPlace`'s,
 * from the best countries that stand today (`standingCountries`: a statement
 * with no end time, `P582`, of a state the claims table shows no dissolution
 * for, `P576`) and the parts (P518) the kept point's statements name, each
 * part's countries read from its own kept entity. A part or a state the
 * subset did not keep has no country, or no dissolution, here, where the live
 * query reads one.
 */

import { foldLabel } from '@tyr/shared/labels';
import { pool } from '../../../db/index.js';
import type { ContainerFacts, EntityFacts, PoolEntity } from '../publicArt/queries.js';
import { countryOfPlace, openCountries, standingCountries, type PlaceCountry } from '../publicArt/countryOfPlace.js';
import { parseWktPoint, preferredCoordinate, preferredPicture } from '../wikidataUtils.js';
import { BEST, entitiesOf, termsOf, type Kept, type Terms } from './entities.js';
import {
  articleUrl, bestStatements, hasEnded, itemOf, itemsOf, picturesOf, standingStatements, textOf, wktOf, yearOf,
} from './values.js';
import type { CompactStatement } from '../../dumps/wikidata/compactEntity.js';

/** The pool row's facts about one kept entity; null for one with no point where a point is required. */
function poolEntity(
  id: string, kept: Kept, terms: Map<string, Terms>, around: Around, placeless: boolean,
): PoolEntity | null {
  const { claims } = kept.entity;
  const points = bestStatements(claims.P625).filter(s => parseWktPoint(wktOf(s.value) ?? '') !== null);
  const wkt = points.map(s => wktOf(s.value)!).reduce<string | null>((kept, next) => preferredCoordinate(kept, next), null);
  if (!wkt && !placeless) return null;
  const itemPictures = picturesOf(claims.P18);
  const picture = itemPictures.reduce<string | null>((kept, url) => preferredPicture(kept, url), null);
  const at = wkt ? parseWktPoint(wkt) : null;
  const parts = points.filter(s => wktOf(s.value) === wkt).flatMap(partsOf);
  const countries = bestStatements(claims.P17).flatMap((statement): PlaceCountry[] => {
    const country = itemOf(statement.value);
    return country ? [{ country, stands: !hasEnded(statement) && !around.dissolved.has(country) }] : [];
  });
  const partCountries = parts.length ? new Set(parts.flatMap(part => around.partCountries.get(part) ?? [])) : null;
  const country = countryOfPlace(standingCountries(countries), partCountries);
  const open = openCountries(countries, partCountries);
  const enwiki = kept.entity.sitelinks.enwiki;
  return {
    qid: id,
    label: terms.get(id)?.label ?? id,
    description: terms.get(id)?.description ?? null,
    lat: at?.lat ?? null,
    lon: at?.lon ?? null,
    onEarth: !wkt?.startsWith('<'),
    imageUrl: picture,
    itemPictures,
    sitelinks: kept.sitelinks,
    countryLabel: country ? terms.get(country)?.label ?? null : null,
    countryOptions: open && {
      candidates: open.keys.map(qid => ({ qid, label: terms.get(qid)?.label ?? qid })),
      noneStands: open.noneStands,
    },
    articleUrl: enwiki ? articleUrl(enwiki) : null,
    website: bestStatements(claims.P856).map(s => textOf(s.value)).find(Boolean) ?? null,
    year: bestStatements(claims.P571).map(s => yearOf(s.value)).find(year => year !== null) ?? null,
  };
}

/** The items a coordinate statement says it applies to (`pq:P518`). */
function partsOf(statement: CompactStatement): string[] {
  return (statement.qualifiers?.P518 ?? []).map(itemOf).filter((id): id is string => id !== null);
}

/** What a place's country is read against: its parts' countries, and the states that are gone. */
interface Around {
  partCountries: Map<string, string[]>;
  /** States with a best dissolution date (`P576`), as `wdt:P576` reads them. */
  dissolved: Set<string>;
}

/**
 * The states among `ids` with a dissolution date, read from the claims table
 * rather than from the states' entities: a pool names the largest items in
 * Wikidata as countries, and only this one statement of each is needed. Best
 * rank, and a no-value statement is none, as `wdt:P576` reads them.
 */
async function dissolvedAmong(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const result = await pool.query<{ subject: string }>(
    `SELECT DISTINCT c.subject FROM wikidata_claims c
      WHERE c.property = 'P576' AND c.subject = ANY($1::text[]) AND c.rank >= 0 AND ${BEST('c')}
        AND c.value IS DISTINCT FROM '{"novalue": true}'::jsonb`,
    [ids],
  );
  return new Set(result.rows.map(row => row.subject));
}

async function poolOf(ids: string[], placeless: boolean): Promise<PoolEntity[]> {
  const kept = await entitiesOf(ids);
  const parts = [...new Set([...kept.values()].flatMap(({ entity }) => bestStatements(entity.claims.P625).flatMap(partsOf)))];
  const countries = [...new Set([...kept.values()].flatMap(({ entity }) => itemsOf(bestStatements(entity.claims.P17))))];
  const [partEntities, dissolved] = await Promise.all([entitiesOf(parts), dissolvedAmong(countries)]);
  const around: Around = {
    partCountries: new Map([...partEntities].map(([id, { entity }]) => [id, itemsOf(bestStatements(entity.claims.P17))])),
    dissolved,
  };
  const terms = await termsOf([...kept.keys(), ...countries]);
  return [...kept].map(([id, entity]) => poolEntity(id, entity, terms, around, placeless))
    .filter((e): e is PoolEntity => e !== null);
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

