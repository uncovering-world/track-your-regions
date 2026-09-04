/**
 * Every Wikidata query the public-art import sends, and the parsing of what
 * comes back. Three questions, each a cached kind (ADR-0030): a pool of
 * entities by class, the facts about each of them, and what their containers
 * are.
 *
 * The pool is asked the way the museum pool is (`museum/queries.ts` carries
 * the measurements): the four broad roots sitelinks-first in fame bands, the
 * narrow classes of the closure in batches, taken whole. The five OPTIONALs
 * the old landmark queries carried are gone from the pool — a monument with
 * seven makers arrived seven times and spent a cap that counted rows (#720) —
 * and the multi-valued facts are one UNION question per batch of entities
 * instead, grouped by entity.
 */

import { extractQid, isQid, parseWktPoint, LABEL_LANGS, type SparqlBinding } from '../wikidataUtils.js';
import { foldLabel } from '../labelFold.js';
import {
  ENTITY_PREFIX,
  HINT_PREFIX,
  bandFilter,
  bandLabel,
  failIfTruncated,
  values,
  type Band,
  type QueryRunner,
  type SparqlFn,
} from '../wikidataQueries.js';

/**
 * The floor of the pool sits below the line a row *stays* above
 * (`STAY_SITELINKS` in the pipeline, 18): an admitted row that slipped to 17
 * is still fetched, so the run can refuse it by name with its number rather
 * than sweep it with the generic reason. A candidate below the floor was
 * never in and is never asked for.
 */
export const POOL_MIN_SITELINKS = 15;

/** No pool query has ever returned this many rows; one that does stops the run. */
export const POOL_LIMIT = 3000;

/**
 * Fame bands for the four broad roots, cut finer at the bottom where more
 * entities live per sitelink. Measured with the admitting classes on
 * 2026-09-04: 600 entities carry coordinates at 15 sitelinks or more, 447 at
 * 18, 300 at 22 — small, but the *scan* a band costs is over every instance of
 * the class, and `monument` alone has tens of thousands.
 */
export const POOL_BANDS: Band[] = [
  { min: 100, max: null },
  { min: 50, max: 100 },
  { min: 30, max: 50 },
  { min: 22, max: 30 },
  { min: 18, max: 22 },
  { min: POOL_MIN_SITELINKS, max: 18 },
];

/** Everything single-valued about a candidate, from the pool row that named it. */
export interface PoolEntity {
  qid: string;
  label: string;
  description: string | null;
  /**
   * Null only for an admitted row asked for by id whose coordinate Wikidata
   * has removed: the pool questions require one, and the by-id question does
   * not, so that such a row reaches the rule and is refused by name.
   */
  lat: number | null;
  lon: number | null;
  /**
   * Whether the coordinate is on this planet. Wikidata writes a point on
   * another globe with the globe's IRI in front of it, and Fallen Astronaut's
   * is on the Moon.
   */
  onEarth: boolean;
  imageUrl: string | null;
  sitelinks: number;
  countryLabel: string | null;
  articleUrl: string | null;
  website: string | null;
  year: number | null;
}

/** What the pool asks about each entity besides why it was collected. */
const POOL_DETAILS = `
      OPTIONAL { ?e wdt:P18 ?img }
      OPTIONAL { ?e wdt:P571 ?inception }
      OPTIONAL { ?e wdt:P17 ?country }
      OPTIONAL { ?e wdt:P856 ?site }
      OPTIONAL { ?article schema:about ?e ; schema:isPartOf <https://en.wikipedia.org/> }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGS}" }`;

const POOL_COLUMNS = '?e ?eLabel ?eDescription ?coord ?sl ?img ?countryLabel ?article ?site (YEAR(?inception) AS ?year)';

function bandedPoolQuery(rootQid: string, band: Band, limit: number): string {
  return `${HINT_PREFIX}
    SELECT ${POOL_COLUMNS} WHERE {
      hint:Query hint:optimizer "None" .
      ?e wikibase:sitelinks ?sl .
      hint:Prior hint:rangeSafe true .
      ${bandFilter(band)}
      ?e wdt:P31 wd:${rootQid} .
      ?e wdt:P625 ?coord .${POOL_DETAILS}
    }
    LIMIT ${limit}`;
}

function classPoolQuery(classQids: string[], limit: number): string {
  return `
    SELECT ${POOL_COLUMNS} WHERE {
      VALUES ?cls { ${values(classQids)} }
      ?e wdt:P31 ?cls ; wdt:P625 ?coord ; wikibase:sitelinks ?sl .
      FILTER(?sl >= ${POOL_MIN_SITELINKS})${POOL_DETAILS}
    }
    LIMIT ${limit}`;
}

/**
 * The entities one answer names, one entry each.
 *
 * The first row of an entity fixes everything: the OPTIONALs cross-multiply
 * when an entity carries two images or two countries, and any of those rows
 * answers the questions asked here. A row whose coordinate does not parse is
 * dropped where the query asked for `P625` — that is a malformed literal, not
 * a missing fact — and kept placeless where it did not (`placeless`), so an
 * admitted row Wikidata still answers for but no longer places is refused by
 * name rather than left to the sweep.
 */
function parsePool(rows: SparqlBinding[], options: { placeless?: boolean } = {}): PoolEntity[] {
  const out = new Map<string, PoolEntity>();
  for (const row of rows) {
    const qid = extractQid(row.e?.value ?? '');
    if (!isQid(qid) || out.has(qid)) continue;
    const wkt = row.coord?.value ?? '';
    const coord = parseWktPoint(wkt);
    if (!coord && !options.placeless) continue;
    out.set(qid, {
      qid,
      label: row.eLabel?.value || qid,
      description: row.eDescription?.value || null,
      lat: coord ? coord.lat : null,
      lon: coord ? coord.lon : null,
      onEarth: !wkt.startsWith('<'),
      imageUrl: row.img?.value || null,
      sitelinks: parseInt(row.sl?.value || '0', 10),
      countryLabel: row.countryLabel?.value || null,
      articleUrl: row.article?.value || null,
      website: row.site?.value || null,
      year: row.year?.value ? parseInt(row.year.value, 10) : null,
    });
  }
  return [...out.values()];
}

/**
 * Entities of one broad class, band by band, merged into one pool.
 *
 * The runner rather than the bare door, because a band is a unit of work a
 * person can be told about and can interrupt. A band that fails after its
 * retries fails the run: the pool decides which rows the category admits
 * (ADR-0024), so a quietly short pool would refuse real monuments and report
 * success. What the bands buy is that each question is small enough to
 * answer, and that a retry starts from the cached bands rather than nothing.
 */
export async function fetchBroadPool(
  run: QueryRunner,
  root: { qid: string; label: string },
  limit = POOL_LIMIT,
): Promise<PoolEntity[]> {
  const entities = new Map<string, PoolEntity>();
  for (let i = 0; i < POOL_BANDS.length; i++) {
    const band = POOL_BANDS[i];
    run.phase(`Fetching ${root.label}s, ${bandLabel(band)} (band ${i + 1}/${POOL_BANDS.length})...`);
    await run.step();
    const rows = await run.sparql(
      bandedPoolQuery(root.qid, band, limit),
      { kind: 'pool', label: `pool: ${root.label}, ${bandLabel(band)}` },
    );
    failIfTruncated(rows, limit, `pool: ${root.label} (${bandLabel(band)})`);
    for (const entity of parsePool(rows)) entities.set(entity.qid, entity);
  }
  return [...entities.values()];
}

/**
 * The same facts the pool carries, for entities asked for by id: the rows the
 * category admits that no class question named this run, so the rule can
 * refuse them with a reason of their own — "14 sitelinks: below the line",
 * "no public-art class", "no coordinates of its own" — rather than leave
 * them to the sweep. No sitelink floor, no class and no coordinate required,
 * since the whole point is that one of them no longer holds.
 *
 * The ids come from the catalogue rather than from code, so they are checked
 * for shape before they are spliced into the query, as the constants are.
 */
export async function fetchEntitiesByIds(
  sparql: SparqlFn,
  qids: string[],
): Promise<PoolEntity[]> {
  const asked = qids.filter(isQid);
  if (!asked.length) return [];
  const rows = await sparql(`
    SELECT ${POOL_COLUMNS} WHERE {
      VALUES ?e { ${values(asked)} }
      ?e wikibase:sitelinks ?sl .
      OPTIONAL { ?e wdt:P625 ?coord }${POOL_DETAILS}
    }`, { kind: 'pool', label: `admitted rows the pool did not name: ${asked.length}` });
  return parsePool(rows, { placeless: true });
}

/** Entities of a batch of narrow classes, taken whole. */
export async function fetchClassPool(
  sparql: SparqlFn,
  classQids: string[],
  limit = POOL_LIMIT,
): Promise<PoolEntity[]> {
  if (!classQids.length) return [];
  const rows = await sparql(
    classPoolQuery(classQids, limit),
    { kind: 'pool', label: `pool: ${classQids.length} narrow classes` },
  );
  failIfTruncated(rows, limit, `pool: ${classQids.length} narrow classes`);
  return parsePool(rows);
}

// =============================================================================
// Facts
// =============================================================================

/**
 * The multi-valued facts about an entity, fetched by UNION so they do not
 * cross-multiply.
 *
 * Whose collection holds it (`P195`) is deliberately not among them:
 * ownership is not a place. HAM Helsinki Art Museum owns the city's outdoor
 * sculpture, the Sibelius Monument included, and the first dry run refused
 * it as a work inside the museum. Where a work is held indoors, `P276`
 * says so — a room of the Louvre, walked up to the Louvre.
 */
export interface EntityFacts {
  /** Every `P31`. */
  classes: string[];
  /** `P276`, a statement carrying an end time dropped: where it stands today. */
  locations: string[];
  /** `P361`: what it is part of. */
  parents: string[];
  /** Every maker the source names, deduped, in the order the answer arrived (ADR-0040). */
  creators: string[];
}

const emptyFacts = (): EntityFacts => ({ classes: [], locations: [], parents: [], creators: [] });

/** Add the entity a binding names, when the binding is present and names one. */
function pushEntity(into: string[], binding: SparqlBinding[string]): void {
  if (!binding) return;
  const qid = extractQid(binding.value);
  if (isQid(qid)) into.push(qid);
}

/**
 * Add one row's maker, if it says anything new: deduped by folded label, and
 * never a label that *is* a QID — the label service answering for an entity
 * it has no name for in any of the eight languages, which names nobody.
 */
function addCreator(into: EntityFacts, seen: Set<string>, row: SparqlBinding): void {
  const label = row.creatorLabel?.value;
  if (!label || isQid(label)) return;
  const key = foldLabel(label);
  if (seen.has(key)) return;
  seen.add(key);
  into.creators.push(label);
}

export async function fetchEntityFacts(
  sparql: SparqlFn,
  qids: string[],
): Promise<Map<string, EntityFacts>> {
  const out = new Map<string, EntityFacts>();
  if (!qids.length) return out;
  for (const qid of qids) out.set(qid, emptyFacts());
  const seenCreators = new Map<string, Set<string>>();

  // A location the entity has left — a P276 statement carrying an end time —
  // is dropped, by the rule the museum import reads a work's P276 under: the
  // Bust of Nefertiti's own statements still name the museum it left in 2009.
  const rows = await sparql(`
    SELECT ?e ?cls ?loc ?parent ?creator ?creatorLabel WHERE {
      VALUES ?e { ${values(qids)} }
      { ?e wdt:P31 ?cls } UNION {
        ?e wdt:P276 ?loc .
        FILTER NOT EXISTS { ?e p:P276 ?st . ?st ps:P276 ?loc ; pq:P582 ?ended }
      } UNION { ?e wdt:P361 ?parent } UNION {
        ?e wdt:P170 ?creator . FILTER(STRSTARTS(STR(?creator), "${ENTITY_PREFIX}Q"))
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGS}" }
    }`, { kind: 'edges', label: `classes, containers and makers of ${qids.length} entities` });

  for (const row of rows) {
    const qid = extractQid(row.e?.value ?? '');
    const facts = out.get(qid);
    if (!facts) continue;
    pushEntity(facts.classes, row.cls);
    pushEntity(facts.locations, row.loc);
    pushEntity(facts.parents, row.parent);
    if (row.creatorLabel) {
      let seen = seenCreators.get(qid);
      if (!seen) { seen = new Set(); seenCreators.set(qid, seen); }
      addCreator(facts, seen, row);
    }
  }
  return out;
}

/**
 * What a container is called, what it is, and what it is in turn inside or
 * part of — the next step of the walk from a room to its museum: Room 325 of
 * the Louvre is a room in the Sully Wing, and the wing is part of the Louvre.
 */
export interface ContainerFacts {
  label: string;
  classes: string[];
  /** `P276` and `P361` of the container itself. */
  parents: string[];
}

export async function fetchContainerFacts(
  sparql: SparqlFn,
  qids: string[],
): Promise<Map<string, ContainerFacts>> {
  const out = new Map<string, ContainerFacts>();
  if (!qids.length) return out;

  // A location the container has left — a P276 statement carrying an end time
  // — is dropped, by the rule the entity facts read a work's own P276 under: a
  // museum a chapel was once inside must not make the chapel's work the
  // museum's.
  const rows = await sparql(`
    SELECT ?c ?cLabel ?cls ?up WHERE {
      VALUES ?c { ${values(qids)} }
      { ?c wdt:P31 ?cls } UNION {
        ?c wdt:P276 ?up .
        FILTER NOT EXISTS { ?c p:P276 ?st . ?st ps:P276 ?up ; pq:P582 ?ended }
      } UNION { ?c wdt:P361 ?up }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGS}" }
    }`, { kind: 'entities', label: `what ${qids.length} containers are, and are in` });

  for (const row of rows) {
    const qid = extractQid(row.c?.value ?? '');
    if (!isQid(qid)) continue;
    let container = out.get(qid);
    if (!container) {
      container = { label: row.cLabel?.value || qid, classes: [], parents: [] };
      out.set(qid, container);
    }
    pushEntity(container.classes, row.cls);
    pushEntity(container.parents, row.up);
  }
  return out;
}
