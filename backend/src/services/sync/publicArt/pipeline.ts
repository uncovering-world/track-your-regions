/**
 * Classes first, then the entities, then what each of them is.
 *
 * Not five direct questions with whatever answers written down: this
 * collects the way the museum import does. It learns which classes count from
 * the class tree, asks for their instances by fame, fetches the facts about
 * each candidate and about what holds it, and only then decides — so every
 * row has a reason that can be named, and every refusal is filed with one.
 *
 * Nothing here decides anything on its own: the rule is `publicArtTest.ts`,
 * the lists are `classes.ts`, the questions are `queries.ts`. This file is
 * the wiring and the fame line.
 */

import { boundedClosure } from '../classClosure.js';
// The works-first kinds' root for a lost or destroyed work, read here too (#872).
import { LOST_WORK_ROOT } from '../museum/worksCollector.js';
import {
  fetchClassTree,
  fetchSubclasses,
  MUSEUM_ROOT,
  type QueryRunner,
} from '../wikidataQueries.js';
import {
  buildTrees,
  COMMEMORATIVE_ROOTS,
  FOUNTAIN_ROOT,
  SCULPTURAL_ROOTS,
  WORSHIP_ROOT,
  type PublicArtTrees,
} from './classes.js';
import { belowLineReason, lineStanding, type LinePair } from '../sourceLine.js';
import { publicArtVerdict } from './publicArtTest.js';
import type { KindRule } from './kindRules.js';
import { emptyFacts, type PoolEntity, type EntityFacts } from './queries.js';
import type { PlaceKind } from '../places/gather.js';
import { chainOf, ownersOf, type Containment } from '../places/containment.js';
import type { FilteredEntity } from '../syncContract.js';
import type { WikidataLandmark } from '../types.js';

/**
 * The world tier's fame line, and the same one the museums use (ADR-0023):
 * a row enters at 22 Wikipedia-language sitelinks and stays until it falls
 * below 18, so the list does not flap as Wikipedia grows. Belonging to the
 * tier is the Iconic badge (ADR-0045 decision 5); the regional tier, which
 * carries none, is filled from regional sources by the rules of
 * docs/tech/filling-a-kind.md (ADR-0048).
 */
export const ENTER_SITELINKS = 22;
export const STAY_SITELINKS = 18;

/**
 * Those two as the pair every kind's line standing is asked with
 * (`sourceLine.ts`). This source states its line in code rather than on its row,
 * so the pair is built here; what is asked of it — in, out, or fallen by name —
 * and the sentence a fallen row is refused with are the shared ones, written
 * once for the whole catalogue (#884).
 */
const LINE: LinePair = { enterSitelinks: ENTER_SITELINKS, staySitelinks: STAY_SITELINKS };

/**
 * The four classes broad enough to need bands: `monument` and `memorial` in
 * the heritage sense have tens of thousands of instances, `sculpture` and
 * `statue` more. Their labels are for the phase message only; the type a
 * reader sees is decided by the verdict.
 */
const BROAD_ROOTS = [
  { qid: 'Q860861', label: 'sculpture' },
  { qid: 'Q179700', label: 'statue' },
  { qid: 'Q4989906', label: 'monument' },
  { qid: 'Q5003624', label: 'memorial' },
];

export interface CollectedPublicArt {
  items: WikidataLandmark[];
  /** Distinct entities the pool named. */
  fetched: number;
  filtered: FilteredEntity[];
}

/**
 * What the gather read, before any kind's rule decided anything: the class
 * trees, every candidate the admitting classes name, and the facts about each
 * of them and about what holds it. The sources of a pass read it whole
 * (ADR-0132), each through its own classification.
 */
export interface GatheredPublicArt {
  trees: PublicArtTrees;
  pool: Map<string, PoolEntity>;
  facts: Map<string, EntityFacts>;
  containers: Containment;
}

async function collectTrees(run: QueryRunner): Promise<PublicArtTrees> {
  // A step before every hop, as the museum walk does: each hop is one query,
  // and the runner's step is where the pacing is spent and a cancel is heard.
  const children = async (qids: string[]) => {
    await run.step();
    return fetchSubclasses(run.sparql, qids);
  };

  run.phase('Walking the class tree under sculpture and statue...');
  const sculptural = await boundedClosure(Object.keys(SCULPTURAL_ROOTS), children);
  run.phase('Walking the class trees under fountain, war memorial and cenotaph...');
  const fountain = await boundedClosure([FOUNTAIN_ROOT], children);
  const commemorative = await boundedClosure(Object.keys(COMMEMORATIVE_ROOTS), children);
  for (const refusal of [...sculptural.refused, ...fountain.refused, ...commemorative.refused]) {
    console.log(`[Landmark Sync] Closure under ${refusal.root} stopped at hop ${refusal.hop}: ${refusal.offered} classes offered`);
  }

  run.phase('Reading what a museum and a place of worship are...');
  await run.step();
  const museum = await fetchClassTree(run.sparql, MUSEUM_ROOT, 'museum classes');
  await run.step();
  const worship = await fetchClassTree(run.sparql, WORSHIP_ROOT, 'places of worship');
  // The works-first kinds' tree for "nothing to stand in front of" (#872): a
  // `destroyed artwork` without the `lost sculpture` class beside it would
  // otherwise pass here and be refused there.
  await run.step();
  const lost = await fetchClassTree(run.sparql, LOST_WORK_ROOT, 'lost artwork classes');

  return buildTrees({
    sculptural: sculptural.classes,
    fountain: fountain.classes,
    commemorative: commemorative.classes,
    museum,
    worship,
    lost,
  });
}

/**
 * Public art and Monuments & memorials as the place gather reads them
 * (`places/gather.ts`): the trees their rules read, and the classes whose
 * instances are their candidates — the broad roots in bands, then every other
 * class a kind admits. The two kinds share one declaration, since both rules
 * read the same trees and each refuses what the other admits by name.
 */
export const PUBLIC_ART_KIND: PlaceKind<PublicArtTrees> = {
  name: 'public art and monuments',
  trees: collectTrees,
  poolClasses: (trees) => ({ broad: BROAD_ROOTS, narrow: trees.admitting }),
  readsContainers: true,
};

/**
 * Decide what of the gather is of the kind `rule` names: the candidates that
 * pass it and clear the fame line, and every candidate it refused, with the
 * reason it gave.
 *
 * `admitted` is what the source holds as admitted before the run, so the
 * stay line has something to hold. `offered` is the places another kind offers a
 * reader, which decides whether a work outdoors on a venue's grounds is
 * stranded there (#1444). Items come back most famous first, which
 * is the order the run writes them in and the order a person watching it
 * reads.
 */
export function classifyPublicArt(
  { trees, pool, facts, containers }: GatheredPublicArt,
  rule: KindRule,
  admitted: ReadonlySet<string>,
  offered?: ReadonlySet<string>,
): CollectedPublicArt {
  const items: WikidataLandmark[] = [];
  const filtered: FilteredEntity[] = [];
  const candidates = [...pool.values()].sort((a, b) => b.sitelinks - a.sitelinks);
  for (const entity of candidates) {
    const known = facts.get(entity.qid) ?? emptyFacts();
    // On a refusal of a row the source admits, the type the classes read: a
    // curator may have put it back, and a put-back is filed under it too
    // (`filePutBackTypes`, ADR-0135).
    const type = admitted.has(entity.qid)
      ? { type: rule.type({ classes: known.classes, commemorates: known.commemorates, genres: known.genres }, trees) }
      : {};
    const verdict = publicArtVerdict({
      qid: entity.qid,
      classes: known.classes,
      containers: chainOf(known, containers),
      collections: ownersOf(known, containers),
      commemorates: known.commemorates,
      depicts: known.depicts,
      genres: known.genres,
      onEarth: entity.onEarth,
      lat: entity.lat,
      lon: entity.lon,
    }, trees, rule, offered);
    if (!verdict.pass) {
      filtered.push({
        externalId: entity.qid, name: entity.label, reason: verdict.reason, ...type,
        // Where it is held, for the kind that holds that place to take it (ADR-0102).
        ...(verdict.heldIn ? { heldIn: verdict.heldIn } : {}),
      });
      continue;
    }
    // The verdict refused anything placeless above; this narrows the type,
    // it cannot fire.
    if (entity.lat === null || entity.lon === null) continue;
    const standing = lineStanding(entity.sitelinks, admitted.has(entity.qid), LINE);
    if (standing === 'out') continue;
    if (standing === 'fell') {
      filtered.push({
        externalId: entity.qid,
        name: entity.label,
        reason: belowLineReason(entity.sitelinks, LINE),
        ...type,
      });
      continue;
    }
    items.push({
      qid: entity.qid,
      label: entity.label,
      description: entity.description,
      lat: entity.lat,
      lon: entity.lon,
      imageUrl: entity.imageUrl,
      itemPictures: entity.itemPictures,
      creators: known.creators,
      year: entity.year,
      sitelinks: entity.sitelinks,
      countryLabel: entity.countryLabel,
      type: verdict.type,
      classes: known.classes,
      artwork: verdict.artwork,
      articleUrl: entity.articleUrl,
      website: entity.website,
    });
  }

  console.log(
    `[Landmark Sync] Pool of ${pool.size} for ${rule.noun}: ${items.length} admitted, ${filtered.length} refused, `
    + `${pool.size - items.length - filtered.length} below the line and never in`,
  );
  return { items, fetched: pool.size, filtered };
}
