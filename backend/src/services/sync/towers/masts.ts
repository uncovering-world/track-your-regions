/**
 * #2275: a broadcast mast is filed under a type of its own, `mast`, rather
 * than as an observation tower. Seeing a structure that tall from the ground is
 * a reason to go, so a mast is never refused for being one; what is told apart
 * here is a mast from a tower people go up. Wikidata's classes cannot do it:
 * the KXTV/KOVR mast and the Tallinn TV Tower both carry "television tower"
 * alone, and "transmitter mast" sits on Sydney Tower and the Skytree. So the
 * kind's type is read again once its tiers have decided, from OpenStreetMap's
 * layer (ADR-0134) and the item's own statements, in this order:
 *
 * 1. **OpenStreetMap maps it as a mast.** An object that carries the item, by
 *    its `wikidata` tag or as the object the item names (`P11693`, `P10689`),
 *    is `man_made=mast`; where none carries it (a miss the layer vouches for),
 *    the nearest mast or tower within `NEAREST_METRES` that carries no item
 *    is, for an item with a transmitter class (the Nador transmitter, 218 m
 *    from its point). A rooftop cell mast beside a campanile says nothing of
 *    the campanile: the Leaning Tower of Pisa has a communication mast 222 m
 *    away, and carries no transmitter class. A guyed construction (`tower:construction=guyed_*`)
 *    counts too, but only on an object with no `tower:type=observation` and no
 *    `tourism` tag: Rozhledna Holedná is a guyed lattice lookout people climb.
 *    A plain `lattice` never counts: OSM tags the Cairo Tower so.
 * 2. **A transmitter nothing marks as visited.** The item carries transmitter
 *    classes alone, no object of the layer carries it (a miss the layer
 *    vouches for), and it states none of `VISIT_PROPERTIES`. The US masts came
 *    into OSM from GNIS as plain towers with no item (KFVS, the KCCI Tower).
 *    Missing visit statements alone would misfile visited towers
 *    (Turkmenistan, Montjuïc and Baku carry none), so they serve only here.
 *
 * Only a tower the classes filed as an observation tower or a plain tower is
 * read again (`RETYPED`): a pagoda, a minaret, a clock tower, a bell tower or a
 * fortified tower keeps its type whatever stands beside it. Measured on the
 * 516 towers admitted on the dev catalogue (2026-11-03, #2275), the first step
 * files eight and the second three, none of them a tower a visitor goes up.
 */

import type { WikidataLandmark } from '../types.js';
import { chunk, values, type SparqlFn } from '../wikidataQueries.js';
import { extractQid, isQid } from '../wikidataUtils.js';
import { readsSubset } from '../subset/reader.js';
import { OSM_ID_PROPERTIES, subsetMastStatements, VISIT_PROPERTIES, type MastStatements } from '../subset/towers.js';
import { layerStructuresReader, type StructuresRead, type StructureQuestion, type StructureTags } from '../osm/localOsm.js';
import { TRANSMITTER_CLASSES, type TowerType } from './classes.js';

export type { MastStatements };

/** How far the nearest mapped structure may stand from the item's point and still be the item's. */
export const NEAREST_METRES = 250;

/** What the layer is asked: masts and towers, and the tags that tell them apart. */
export const MAST_TAGS: StructureTags = {
  manMade: ['mast', 'tower', 'communications_tower'],
  keys: ['man_made', 'tower:type', 'tower:construction', 'tourism'],
  radiusMetres: NEAREST_METRES,
};

/** An object's tags, only the keys `MAST_TAGS` reads. */
export type StructureTagsOf = Readonly<Record<string, string>>;

/** What a tower's type is read from beside its classes. */
export interface MastFacts {
  /** Every `P31` it carries, as the rule read them. */
  classes: readonly string[];
  /** The tags of every object that carries its item. */
  carried: readonly StructureTagsOf[];
  /** The tags of the nearest structure that carries no item, where none carries it. */
  nearest: StructureTagsOf | null;
  /** Whether no object carrying the item is a fact (`StructuresRead.missesAreFacts`). */
  missesAreFacts: boolean;
  /** Which of `VISIT_PROPERTIES` the item states. */
  visit: readonly string[];
}

/** Why a tower is a mast: the map says so of its object, of the structure beside its point, or it is a transmitter nothing marks as visited. */
export type MastSign = 'mapped' | 'nearest' | 'transmitter';

const TRANSMITTERS: ReadonlySet<string> = new Set(Object.keys(TRANSMITTER_CLASSES));

/** The types a mast may have been filed under by its classes, and so the only ones read again. */
export const RETYPED: readonly TowerType[] = ['observation-tower', 'tower'];

/** Whether OpenStreetMap maps an object as a mast: `man_made=mast`, or a guyed construction on an object no one is let up. */
function mappedAsMast(tags: StructureTagsOf): boolean {
  if (tags.man_made === 'mast') return true;
  return (tags['tower:construction'] ?? '').startsWith('guyed_') && tags['tower:type'] !== 'observation' && tags.tourism === undefined;
}

/** Whether a tower is a mast, and why; null for one a visitor may go up, or one nothing tells. */
export function mastSign(facts: MastFacts): MastSign | null {
  if (facts.carried.some(mappedAsMast)) return 'mapped';
  // Both steps below stand on no object carrying the item, a fact only on a layer that vouches for its misses.
  if (facts.carried.length || !facts.missesAreFacts) return null;
  const transmitter = facts.classes.some((cls) => TRANSMITTERS.has(cls));
  if (transmitter && facts.nearest && mappedAsMast(facts.nearest)) return 'nearest';
  const transmitterOnly = facts.classes.length > 0 && facts.classes.every((cls) => TRANSMITTERS.has(cls));
  return transmitterOnly && facts.visit.length === 0 ? 'transmitter' : null;
}

const BATCH = 100;

/** Each item's statements of the map and of a visit, from the subset or the live service; an item neither answers states none. */
export async function fetchMastStatements(sparql: SparqlFn, qids: readonly string[]): Promise<Map<string, MastStatements>> {
  const asked = [...new Set(qids.filter(isQid))];
  const out = new Map<string, MastStatements>();
  for (const batch of chunk(asked, BATCH)) {
    const answer = readsSubset(sparql) ? await subsetMastStatements(batch) : await liveMastStatements(sparql, batch);
    for (const [qid, statements] of answer) out.set(qid, statements);
  }
  return out;
}

/** The live twin of `subsetMastStatements`: one row a statement, as `wdt:` reads it. */
async function liveMastStatements(sparql: SparqlFn, qids: string[]): Promise<Map<string, MastStatements>> {
  const properties = [...Object.keys(OSM_ID_PROPERTIES), ...VISIT_PROPERTIES];
  const rows = await sparql(`
    SELECT ?e ?prop ?v WHERE {
      VALUES ?e { ${values(qids)} }
      VALUES ?prop { ${properties.map((p) => `wd:${p}`).join(' ')} }
      ?prop wikibase:directClaim ?claim .
      ?e ?claim ?v .
    }`, { kind: 'entities', label: `whether ${qids.length} towers are mapped or visited` });
  const out = new Map<string, MastStatements>();
  for (const row of rows) {
    const qid = extractQid(row.e?.value ?? '');
    const property = extractQid(row.prop?.value ?? '');
    const value = row.v?.value ?? '';
    if (!isQid(qid)) continue;
    const statements = out.get(qid) ?? { refs: [], visit: [] };
    const kind = OSM_ID_PROPERTIES[property as keyof typeof OSM_ID_PROPERTIES];
    if (kind && /^\d+$/.test(value)) statements.refs.push(`${kind}/${value}`);
    else if ((VISIT_PROPERTIES as readonly string[]).includes(property) && !statements.visit.includes(property)) statements.visit.push(property);
    out.set(qid, statements);
  }
  return out;
}

/** How the layer is read: `layerStructuresReader`, or a test's. */
export type ReadStructures = (places: readonly StructureQuestion[], tags: StructureTags) => Promise<StructuresRead | null>;

/**
 * File every tower `mastSign` names as a mast, once the kind's tiers and the
 * gone refusal have decided: a tower its classes filed under one of `RETYPED`
 * becomes a `mast`, and nothing is refused. Only those towers are asked about.
 * Where no layer is in place only the classes file a mast, and the run's log
 * says so. Returns how many it filed.
 */
export async function fileMasts(
  items: WikidataLandmark[], sparql: SparqlFn, logPrefix: string, readLayer: ReadStructures = layerStructuresReader(),
): Promise<number> {
  const asked = items.filter((item) => (RETYPED as readonly string[]).includes(item.type));
  if (!asked.length) return 0;
  const statements = await fetchMastStatements(sparql, asked.map((item) => item.qid));
  const stated = (qid: string) => statements.get(qid) ?? { refs: [], visit: [] };
  const read = await readLayer(asked.map((item) => ({ qid: item.qid, lat: item.lat, lon: item.lon, refs: stated(item.qid).refs })), MAST_TAGS);
  if (!read) {
    console.log(`${logPrefix} No OpenStreetMap layer is in place: only Wikidata's classes file a tower as a mast this run`);
    return 0;
  }
  const filed: string[] = [];
  for (const item of asked) {
    const mapped = read.byItem.get(item.qid);
    const sign = mastSign({
      classes: item.classes,
      carried: mapped?.carried.map((object) => object.tags) ?? [],
      nearest: mapped?.nearest?.tags ?? null,
      missesAreFacts: read.missesAreFacts,
      visit: stated(item.qid).visit,
    });
    if (!sign) continue;
    item.type = 'mast';
    filed.push(`${item.label} (${sign})`);
  }
  if (filed.length) console.log(`${logPrefix} Filed as masts: ${filed.join(', ')}`);
  return filed.length;
}
