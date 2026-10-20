/**
 * The four witnesses read for a set of places at once (#1768): the guide from
 * the Wikivoyage usage build, the formal statements and the Commons category
 * from Wikidata, the photographs from Commons, and the map from the
 * OpenStreetMap objects the run has already read. Kind-agnostic: a kind hands
 * over its places and its objects, and decides what to do with the answer.
 */

import { usedByAGuide } from '../../dumps/wikivoyage/usageTables.js';
import type { OsmObject } from '../osm/types.js';
import type { SparqlFn } from '../wikidataQueries.js';
import { photographed, type PhotoPlace, type PhotoSend } from './commonsPhotos.js';
import { fetchVisitFacts } from './visitFacts.js';
import { mapWitness, witnessesOf, type Witness } from './witnesses.js';

/** A place the witnesses are asked about: its item and its point, where it has one. */
export interface WitnessPlace {
  qid: string;
  lat: number | null;
  lon: number | null;
}

/** What a kind's run is handed: the witnesses of each place, in their reading order. */
export type VisitWitnessReader = (
  places: readonly WitnessPlace[], objects: ReadonlyMap<string, readonly OsmObject[]>,
) => Promise<Map<string, Witness[]>>;

export interface VisitWitnessDoors {
  /** The run's Wikidata, live or the subset. */
  sparql: SparqlFn;
  /** Commons, behind the run's cache (`commonsPhotoDoor`). */
  photos: PhotoSend;
  /** The guide's answer; the Wikivoyage usage build unless a test names another. */
  guide?: (qids: readonly string[]) => Promise<Set<string>>;
}

/** The reader a run passes its kind, over the run's doors. */
export function visitWitnessReader(doors: VisitWitnessDoors): VisitWitnessReader {
  const guideOf = doors.guide ?? usedByAGuide;
  return async (places, objects) => {
    const out = new Map<string, Witness[]>();
    if (places.length === 0) return out;
    const qids = places.map((place) => place.qid);
    const guide = await guideOf(qids);
    const facts = await fetchVisitFacts(doors.sparql, qids);
    const withCategory: PhotoPlace[] = places.flatMap((place) => {
      const category = facts.get(place.qid)?.commonsCategory;
      return category && place.lat !== null && place.lon !== null
        ? [{ qid: place.qid, category, lat: place.lat, lon: place.lon }] : [];
    });
    const photos = await photographed(doors.photos, withCategory);
    for (const { qid } of places) {
      out.set(qid, witnessesOf({
        guide: guide.has(qid),
        photos: photos.get(qid) ?? false,
        formal: facts.get(qid)?.formal ?? false,
        map: mapWitness(objects.get(qid) ?? []),
      }));
    }
    return out;
  };
}
