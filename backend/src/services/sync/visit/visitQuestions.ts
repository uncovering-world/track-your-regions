/**
 * A kind's run asks a curator about a place it offers where both signals say
 * a visitor finds nothing there (#1770): fewer than two of the four visit
 * witnesses vouch for it (ADR-0128), and Jev reads it, at `VISIT_QUESTION_SURE`
 * or more, as nothing to see, not a place or an object (`visitReading.ts`).
 * The maintainer decided on 2026-10-21 that such a place is asked of a
 * curator with the refusal suggested, never refused by the rule: ADR-0087
 * keeps Jev's answer a suggestion.
 *
 * Neither signal alone is enough. Over the 2,269 items the four kinds offered
 * outside World Heritage on 2026-10-21, 299 had fewer than two witnesses, and
 * about two thirds of those are places a visitor goes to whose traces the
 * sources miss — Saqqara, the Giza Necropolis, Cloud Gate. Both together
 * picked 46, and 45 of them are not a place to offer: the Arch of
 * Reunification, Eboracum, the Rondanini Pietà.
 *
 * Asked once per membership: a membership with a question, open or answered,
 * is not read again, so a curator's keep is never asked twice. A membership
 * whose admission a curator pinned is not asked either, since a person has
 * answered for it. The witnesses are read in order of cost — the guide and
 * Wikidata for every place, the map for the places still short, the
 * photographs only where they decide — and Jev only for a place still short,
 * reusing a reading the place already has. Without Jev nothing is asked.
 *
 * World Heritage is not asked: UNESCO's list is the authority there.
 */

import { pool } from '../../../db/index.js';
import { MEMBERSHIPS, admissionPinnedSql, membershipOfferedSql } from '../../../db/membership.js';
import { usedByAGuide } from '../../dumps/wikivoyage/usageTables.js';
import { jevConfigured } from '../../jev/jevClient.js';
import { OSM_BATCH, OsmDoorFailedError, readOsmObjects, type OsmDoor } from '../osm/readOsmObjects.js';
import { qleverOsmDoor } from '../osm/qleverOsm.js';
import type { KeepWkt, OsmObject } from '../osm/types.js';
import { subsetOnlyDoor, wikidataReaderOf } from '../subset/reader.js';
import type { SyncProgress, VisitQuestionTally } from '../types.js';
import { withCache } from '../wikidataCache.js';
import { chunk, type SparqlFn } from '../wikidataQueries.js';
import {
  delay, sparqlQuery, SPARQL_DELAY_MS, SPARQL_WAIT_BUDGET_MS, waitMessage, WaitBudget, WIKIDATA_USER_AGENT,
} from '../wikidataUtils.js';
import { commonsPhotoDoor, photographed, type PhotoPlace, type PhotoSend } from './commonsPhotos.js';
import { readVisit, type Reading } from './readVisit.js';
import { fetchVisitFacts } from './visitFacts.js';
import { articleLeads, type VisitAsked, type VisitReading } from './visitReading.js';
import { askedSql, newestReadingSql } from './visitSuggestions.js';
import { WITNESSES_NEEDED, mapWitness, witnessesOf, type Witness } from './witnesses.js';

const LOG_PREFIX = '[Visit questions]';

/** How sure Jev must be that there is nothing to visit before a curator is asked (#1770). */
export const VISIT_QUESTION_SURE = 0.7;

/** The readings that say a visitor finds nothing to visit there. */
export const NOT_A_VISIT: ReadonlySet<VisitReading> = new Set<VisitReading>(['nothing', 'not-a-place', 'object']);

/** The sources whose runs ask: every kind but World Heritage. */
export const ASKING_SOURCES: ReadonlySet<number> = new Set([2, 3, 4, 5, 6]);

/** The map is read for its tags alone. */
const NO_GEOMETRY: KeepWkt = { historic: [], manMade: [], boundary: [] };

/** How many places are read by Jev at once. */
const READ_AT_ONCE = 4;

/** A place the run offers, as the witnesses and Jev are asked about it. */
export interface OfferedPlace {
  membershipId: number;
  experienceId: number;
  qid: string;
  name: string;
  lat: number | null;
  lon: number | null;
  asked: VisitAsked;
  /** The reading the place already has as it stands, or null. */
  stored: { reading: VisitReading | null; confidence: number } | null;
}

/** The doors a run reads the witnesses and Jev through. */
export interface VisitQuestionDoors {
  sparql: SparqlFn;
  osm: (qids: string[]) => Promise<Map<string, OsmObject[]>>;
  photos: PhotoSend;
  guide?: (qids: readonly string[]) => Promise<Set<string>>;
  /** Jev's reading of a place, given its article's lead where the run read one (`leads`). */
  read?: (place: OfferedPlace, lead?: string | null) => Promise<Reading | null>;
  /** The leads of the places' articles, read for all at once (`articleLeads`); absent leaves each read its own. */
  leads?: (articleUrls: readonly (string | null)[]) => Promise<Map<string | null, string | null>>;
}

/** The source's offered memberships no question was ever raised on, with a Wikidata item. */
export async function offeredPlaces(sourceId: number): Promise<OfferedPlace[]> {
  const result = await pool.query<{
    membership_id: number; experience_id: number; qid: string; name: string;
    lat: number | null; lon: number | null; asked: VisitAsked; stored: OfferedPlace['stored'];
  }>(
    `SELECT m.id AS membership_id, e.id AS experience_id, m.external_id AS qid, e.name,
            ST_Y(e.location) AS lat, ST_X(e.location) AS lon,
            ${askedSql('e')} AS asked, ${newestReadingSql('e')} AS stored
       FROM ${MEMBERSHIPS} m
       JOIN experiences e ON e.id = m.experience_id
      WHERE m.source_id = $1 AND ${membershipOfferedSql('m')} AND NOT ${admissionPinnedSql('m')}
        AND e.missing_since IS NULL AND m.external_id ~ '^Q[0-9]+$'
        AND NOT EXISTS (SELECT 1 FROM experience_visit_questions q WHERE q.membership_id = m.id)
      ORDER BY m.id`,
    [sourceId],
  );
  return result.rows.map((row) => ({
    membershipId: row.membership_id, experienceId: row.experience_id, qid: row.qid, name: row.name,
    lat: row.lat, lon: row.lon, asked: row.asked, stored: row.stored,
  }));
}

/**
 * The witnesses of each place, read in order of cost: the guide and
 * Wikidata's statements for all, the map for those still short of two, and
 * the photographs only for a place one witness short, where they decide. A
 * place two witnesses vouch for is not asked more: its list may name fewer
 * than every witness it has.
 *
 * The map door answers for the items it could read: one it left out (a batch
 * the mirror did not answer) is `unread`, since the witness it might have
 * given is not known, and the caller asks nothing of it.
 */
export async function witnessesOfPlaces(
  places: readonly OfferedPlace[], doors: VisitQuestionDoors,
): Promise<{ witnesses: Map<string, Witness[]>; unread: Set<string> }> {
  const qids = [...new Set(places.map((place) => place.qid))];
  const guide = await (doors.guide ?? usedByAGuide)(qids);
  const facts = await fetchVisitFacts(doors.sparql, qids);
  const answers = new Map(qids.map((qid) => [qid, {
    guide: guide.has(qid), formal: facts.get(qid)?.formal ?? false, map: false, photos: false,
  }]));
  const short = () => qids.filter((qid) => witnessesOf(answers.get(qid)!).length < WITNESSES_NEEDED);
  const onTheMap = short();
  const objects = await doors.osm(onTheMap);
  for (const [qid, found] of objects) answers.get(qid)!.map = mapWitness(found);
  const unread = new Set(onTheMap.filter((qid) => !objects.has(qid)));
  const deciding = new Set(short().filter((qid) => witnessesOf(answers.get(qid)!).length === WITNESSES_NEEDED - 1));
  const photoPlaces: PhotoPlace[] = [];
  for (const place of places) {
    const category = facts.get(place.qid)?.commonsCategory;
    if (!deciding.has(place.qid) || unread.has(place.qid) || !category || place.lat === null || place.lon === null) continue;
    deciding.delete(place.qid);
    photoPlaces.push({ qid: place.qid, category, lat: place.lat, lon: place.lon });
  }
  for (const [qid, yes] of await photographed(doors.photos, photoPlaces)) answers.get(qid)!.photos = yes;
  return { witnesses: new Map(qids.map((qid) => [qid, witnessesOf(answers.get(qid)!)])), unread };
}

/** Read `items` through `work`, `READ_AT_ONCE` at a time, in order. */
async function inTurn<T, R>(items: readonly T[], work: (item: T) => Promise<R>, isCancelled: () => boolean): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length && !isCancelled()) {
      const i = next;
      next += 1;
      out[i] = await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_AT_ONCE, items.length) }, worker));
  return out;
}

/** The question the run raises, where it raises one. */
export interface VisitQuestion {
  place: OfferedPlace;
  witnesses: Witness[];
  reading: Reading;
}

/**
 * What the run asks of its offered places: the witnesses, Jev's reading of
 * every place short of two, and the questions where both say a visitor finds
 * nothing there. Writes no question; the readings Jev gave are recorded as
 * every reading is (`readVisit`), so a later run or card does not pay twice.
 * A place whose map the mirror did not answer, or whose article's lead
 * Wikipedia did not give, is counted `unread` and neither read by Jev nor
 * asked: the next run reads it, since it raised no question.
 */
export async function visitQuestionsOf(
  places: readonly OfferedPlace[], doors: VisitQuestionDoors, isCancelled: () => boolean = () => false,
): Promise<{ short: number; unread: number; questions: VisitQuestion[] }> {
  const { witnesses, unread } = await witnessesOfPlaces(places, doors);
  const short = places.filter((place) => !unread.has(place.qid)
    && (witnesses.get(place.qid)?.length ?? 0) < WITNESSES_NEEDED);
  const read = doors.read
    ?? ((place: OfferedPlace, lead?: string | null) => readVisit(place.experienceId, place.asked, () => 'TRUE', lead));
  // The leads of the places Jev is to read, read together, so Wikipedia is
  // asked a few times in turn rather than once per place at once.
  const toRead = short.filter((place) => !place.stored);
  const leads = doors.leads ? await doors.leads(toRead.map((place) => place.asked.article)) : null;
  const noLead = new Set(leads ? toRead.filter((place) => !leads.has(place.asked.article)).map((place) => place.qid) : []);
  const readable = short.filter((place) => !noLead.has(place.qid));
  const readings = await inTurn(readable, async (place) => {
    // Read already for the place as it stands: Jev's word, or none where its
    // answer was refused — either way not asked, nor paid for, again.
    if (place.stored) {
      return place.stored.reading === null ? null
        : { reading: place.stored.reading, confidence: Number(place.stored.confidence) };
    }
    return read(place, leads ? leads.get(place.asked.article) : undefined);
  }, isCancelled);
  const questions: VisitQuestion[] = [];
  readable.forEach((place, i) => {
    const reading = readings[i];
    if (reading && NOT_A_VISIT.has(reading.reading) && reading.confidence >= VISIT_QUESTION_SURE) {
      questions.push({ place, witnesses: witnesses.get(place.qid) ?? [], reading });
    }
  });
  const unreadCount = places.filter((place) => unread.has(place.qid) || noLead.has(place.qid)).length;
  return { short: readable.length, unread: unreadCount, questions };
}

/**
 * Write the run's questions, one per membership. A membership asked meanwhile
 * keeps its question as it was.
 */
async function writeVisitQuestions(questions: readonly VisitQuestion[], syncLogId: number): Promise<number> {
  if (questions.length === 0) return 0;
  const result = await pool.query(
    `INSERT INTO experience_visit_questions (membership_id, witnesses, reading, confidence, sync_log_id)
     SELECT q.membership_id, ARRAY(SELECT jsonb_array_elements_text(q.witnesses)), q.reading, q.confidence, $2
       FROM jsonb_to_recordset($1::jsonb) AS q(membership_id int, witnesses jsonb, reading text, confidence numeric)
     ON CONFLICT (membership_id) DO NOTHING`,
    [JSON.stringify(questions.map((question) => ({
      membership_id: question.place.membershipId, witnesses: question.witnesses,
      reading: question.reading.reading, confidence: question.reading.confidence,
    }))), syncLogId],
  );
  return result.rowCount ?? 0;
}

/**
 * The run's doors: Wikidata as the admin set the source to read it, the map
 * through the mirror, and Commons, each live answer kept in the source's
 * cache like every other the run pays for.
 */
async function doorsOf(sourceId: number, progress: SyncProgress, refreshCache: boolean): Promise<VisitQuestionDoors> {
  const budget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  const cache = { sourceId, enabled: !refreshCache };
  const onWait = (source: string) => (wait: Parameters<typeof waitMessage>[1]) => {
    progress.statusMessage = waitMessage(source, wait, budget);
  };
  const sparql: SparqlFn = (await wikidataReaderOf(sourceId)) === 'subset'
    ? subsetOnlyDoor()
    : withCache((query) => sparqlQuery(query, LOG_PREFIX, {
      budget, isCancelled: () => progress.cancel, onWait: onWait('Wikidata'),
    }), cache);
  const mirror = qleverOsmDoor(progress, budget, LOG_PREFIX);
  const door: OsmDoor = { ...mirror, send: withCache(mirror.send, cache) };
  const photos = withCache(commonsPhotoDoor({
    userAgent: WIKIDATA_USER_AGENT,
    isCancelled: () => progress.cancel,
    pause: () => delay(SPARQL_DELAY_MS),
    budget,
    onWait: onWait('Commons'),
  }), cache);
  return {
    sparql,
    osm: (qids) => mapOfWhatAnswered(door, qids, progress),
    photos,
    leads: (urls) => articleLeads(urls, {
      userAgent: WIKIDATA_USER_AGENT,
      isCancelled: () => progress.cancel,
      pause: () => delay(SPARQL_DELAY_MS),
      onWait: onWait('Wikipedia'),
    }, budget),
  };
}

/** Batches the mirror may drop in a row before the map is left for the next run. */
export const MAP_DROPS_IN_A_ROW = 2;

/**
 * What the map holds for each item, a batch at a time, leaving out the items
 * of a batch the mirror did not answer after its retries: the mirror is slow
 * at times, and one batch it drops must not cost the run every question.
 * A mirror that drops `MAP_DROPS_IN_A_ROW` batches running is taken as down,
 * and the items after them are left out too, rather than each batch spending
 * its own retries. A Cancel is never a dropped batch: it ends the read.
 */
export async function mapOfWhatAnswered(door: OsmDoor, qids: string[], progress: SyncProgress): Promise<Map<string, OsmObject[]>> {
  const out = new Map<string, OsmObject[]>();
  const batches = chunk(qids, OSM_BATCH);
  let dropped = 0;
  for (let i = 0; i < batches.length && dropped < MAP_DROPS_IN_A_ROW; i++) {
    try {
      const read = await readOsmObjects(door, batches[i], NO_GEOMETRY, {
        phase: () => { progress.statusMessage = `Asking OpenStreetMap what it maps at the offered places (batch ${i + 1}/${batches.length})...`; },
        step: async () => { if (progress.cancel) throw new Error('Sync cancelled'); },
      });
      for (const [qid, objects] of read) out.set(qid, objects);
      dropped = 0;
    } catch (error) {
      if (!(error instanceof OsmDoorFailedError) || progress.cancel) throw error;
      dropped += 1;
      console.warn(`${LOG_PREFIX} OpenStreetMap left ${batches[i].length} places unread: ${error.message}`);
      if (dropped === MAP_DROPS_IN_A_ROW && i < batches.length - 1) {
        console.warn(`${LOG_PREFIX} OpenStreetMap dropped ${dropped} batches in a row: the rest of the map is left for the next run`);
      }
    }
  }
  return out;
}

/**
 * The run's step (#1770): ask about the source's offered places, write the
 * questions on a real run, and say what it found on `progress.visitQuestions`
 * for the run's closing line. A preview writes no question; the readings Jev
 * gave it are kept, as a card's are. Without Jev, or for World Heritage,
 * nothing is asked. Runs after the run's changeset is kept, and a Cancel
 * stops it alone.
 */
export async function askVisitQuestions(
  sourceId: number, progress: SyncProgress, options: { refreshCache?: boolean; doors?: VisitQuestionDoors } = {},
): Promise<void> {
  const { logId } = progress;
  if (!ASKING_SOURCES.has(sourceId) || !jevConfigured() || logId === null) return;
  const places = await offeredPlaces(sourceId);
  if (places.length === 0) return;
  progress.statusMessage = `Asking whether a visitor finds something at ${places.length} offered places...`;
  // The run's items are done and its changeset kept: a Cancel pressed now
  // stops the asking alone. What was read by then is asked, the rest is read
  // by the next run, and the run ends as it would have.
  progress.askingVisitQuestions = true;
  try {
    const doors = options.doors ?? await doorsOf(sourceId, progress, options.refreshCache === true);
    let asking: Awaited<ReturnType<typeof visitQuestionsOf>>;
    try {
      asking = await visitQuestionsOf(places, doors, () => progress.cancel);
    } catch (error) {
      // A Cancel during the witnesses' reads stops a door with an error: that
      // is the asking stopped before any place was read, not a failure.
      if (!progress.cancel) throw error;
      progress.visitQuestions = { read: 0, short: 0, asked: 0, stopped: true };
      return;
    }
    const { short, unread, questions } = asking;
    const asked = progress.dryRun ? questions.length : await writeVisitQuestions(questions, logId);
    for (const question of questions) {
      console.log(`${LOG_PREFIX} ${progress.dryRun ? 'Would ask' : 'Asking'} about ${question.place.name} `
        + `(${question.place.qid}): ${question.reading.reading} at ${question.reading.confidence}, `
        + `witnesses: ${question.witnesses.join(', ') || 'none'}`);
    }
    const tally: VisitQuestionTally = { read: places.length - unread, short, asked, ...(unread ? { unread } : {}) };
    progress.visitQuestions = tally;
  } finally {
    progress.askingVisitQuestions = false;
    if (progress.cancel) {
      progress.cancel = false;
      progress.visitQuestions = { ...(progress.visitQuestions ?? { read: 0, short: 0, asked: 0 }), stopped: true };
    }
  }
}
