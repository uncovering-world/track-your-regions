/**
 * The works under the pool's floor the marks door may open for (ADR-0169):
 * Cadillac Ranch carries 10 Wikipedia editions, the Sun Voyager 9,
 * Salvation Mountain 10 — under the 15 the class questions ask for
 * (`POOL_MIN_SITELINKS`) — and each is listed by Atlas Obscura or used by a
 * Wikivoyage guide and read tens of thousands of times a year. The readership
 * names the items first, at the door's bar; the marks narrow them; Wikidata is
 * asked only which of those carry a class the kind admits with a point, then
 * for their rows, their facts, what holds them and what they depict, as the
 * gather reads them for every candidate. What comes back joins the share as a
 * class question's row would, and the rule reads it unchanged.
 */

import { chunk, type SparqlFn } from '../wikidataQueries.js';
import { fetchEntitiesByIds, fetchEntityFacts, POOL_MIN_SITELINKS, type EntityFacts, type PoolEntity } from './queries.js';
import { fetchPlacedAmong } from '../archaeology/queries.js';
import { readAtLeast, readershipYear } from '../../dumps/readership/workReadership.js';
import { usedByAGuide } from '../../dumps/wikivoyage/usageTables.js';
import { emptyContainment, loadContainment, type Containment } from '../places/containment.js';
import type { KindShare } from '../places/gather.js';
import { loadSubjects, type SubjectFacts } from './subjects.js';
import { fetchStreetArtMarks } from './streetArtQueries.js';
import { PUBLIC_CLOCK_CLASSES, type PublicArtTrees } from './classes.js';

const ID_BATCH = 50;

/** The rows the door may open for under the floor, with everything the rule reads of them. */
export interface UnderFloorWorks {
  entities: PoolEntity[];
  facts: Map<string, EntityFacts>;
  containers: Containment;
  subjects: Map<string, SubjectFacts>;
}

const none = (): UnderFloorWorks => ({ entities: [], facts: new Map(), containers: emptyContainment(), subjects: new Map() });

/**
 * The works under the floor read at `bar` or over in the latest year and
 * marked — used by a guide, where the usage build speaks, or listed by Atlas
 * Obscura — never one the pool already holds. Nothing without a year of
 * readership: the door reads none where none is folded.
 */
export async function collectWorksUnderFloor(
  sparql: SparqlFn,
  share: KindShare<PublicArtTrees>,
  bar: number,
  guideSpeaks: boolean,
  logPrefix: string,
): Promise<UnderFloorWorks> {
  const year = await readershipYear();
  if (!year) return none();
  const read = (await readAtLeast(year, bar, POOL_MIN_SITELINKS)).filter((qid) => !share.pool.has(qid));
  if (!read.length) return none();
  const guided = guideSpeaks ? await usedByAGuide(read) : new Set<string>();
  const marks = await fetchStreetArtMarks(sparql, read);
  const named = read.filter((qid) => guided.has(qid) || marks.get(qid)?.atlasObscura);
  if (!named.length) return none();
  // The classes Public art's rule admits by (`PUBLIC_ART_RULE.admits`), not the
  // pool's whole admitting set: the heritage senses of monument are Monuments &
  // memorials' candidates, and asking for them here would hand the rule a
  // hundred national monuments to refuse by name on every run.
  const admits = new Set([...share.trees.sculptural, ...share.trees.fountain, ...Object.keys(PUBLIC_CLOCK_CLASSES)]);
  const works = await fetchPlacedAmong(sparql, named, admits);
  if (!works.length) return none();
  const entities: PoolEntity[] = [];
  for (const batch of chunk(works, ID_BATCH)) {
    for (const entity of await fetchEntitiesByIds(sparql, batch, 'works the world reads under the pool floor')) {
      if (entity.sitelinks < POOL_MIN_SITELINKS) entities.push(entity);
    }
  }
  const facts = await fetchEntityFacts(sparql, entities.map((entity) => entity.qid));
  // The gather's own readers of what holds a candidate and what it depicts,
  // on a runner that paces nothing: the pass's door is the subset's, or paces itself.
  const run = { sparql, phase: () => {}, step: () => Promise.resolve() };
  const containers = await loadContainment(run, [...facts.values()]);
  const subjects = await loadSubjects(run, [...facts.values()].flatMap((known) => known.depicts));
  console.log(`${logPrefix} Under the pool floor: ${read.length} items read at ${bar.toLocaleString('en')} or over, `
    + `${named.length} marked, ${entities.length} works`);
  return { entities, facts, containers, subjects };
}
