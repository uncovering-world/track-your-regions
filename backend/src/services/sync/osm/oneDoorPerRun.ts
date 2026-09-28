/**
 * One door per run: which door a run reads OpenStreetMap through, and what
 * it does when the mirror fails.
 *
 * ADR-0059 decision 2 promises that every OSM fact names where it came from,
 * so a run never switches doors in the middle of a read: a day's extents half
 * from the mirror and half from Overpass would carry one provenance for two
 * sources. The fallback is therefore taken at the level of the promise — **the
 * run, not the batch**. When the mirror fails, the whole read is done again
 * through Overpass from its first question, whatever the mirror answered this
 * run is discarded, and the run's facts all come from the door that finished.
 *
 * A pass is the run's whole collection through one door, built by the caller
 * (`pass`), because the OSM questions are asked in the middle of it: the map's
 * list of digs decides which candidates exist, and the per-item read comes
 * after Wikidata has judged them. Each pass is complete — its own doors, its
 * own wait budget — so the second is not handicapped by the patience the
 * first spent on a mirror that was never going to answer. A run waits at most
 * twice its budget, and only on the day the mirror fails.
 *
 * What counts as the mirror failing is typed, never guessed from a message:
 * a question the door could not get answered (`OsmDoorFailedError`) or an
 * answer too empty to judge anything by (`OsmEmptyAnswerError`, the enumeration's
 * emptiness and the site door's answer-share floor). A Wikidata batch lost, a
 * Wikipedia category unreadable, a cancel — none of those is about the map,
 * and each ends the run, with no second pass.
 */

import { OsmDoorFailedError, OsmEmptyAnswerError, type OsmDoor, type OsmReaderName } from './readOsmObjects.js';

/** The run's collection through one door, and the answers it can take back. */
export interface DoorPass<T> {
  door: OsmDoor;
  /** Runs the whole collection through `door`. */
  read: () => Promise<T>;
  /**
   * Drops the cached answers this pass's door touched, read or written, and
   * says how many — the day's cache holds them for a day (ADR-0030), and a
   * failed door's answers must not be what the next run reads.
   */
  forget: () => Promise<number>;
}

/** Neither door could be read: the run ends, with both reasons in its message. */
export class OsmBothDoorsFailedError extends Error {
  constructor(mirror: Error, overpass: Error) {
    super(
      `OpenStreetMap could not be read through either door — the mirror: ${mirror.message}; `
      + `Overpass, on the fallback: ${overpass.message}`,
      { cause: overpass },
    );
    this.name = 'OsmBothDoorsFailedError';
  }
}

/** The door in the run log's words, with the name `OSM_READER` takes beside it. */
export function describeDoor(name: OsmReaderName): string {
  return name === 'overpass'
    ? 'the public Overpass API (overpass)'
    : 'the QLever osm-planet mirror (qlever)';
}

function isMapFailure(error: unknown): error is Error {
  return error instanceof OsmDoorFailedError || error instanceof OsmEmptyAnswerError;
}

/**
 * Whether a failed pass's answers are dropped. Always for the mirror, whose
 * failure starts a pass that must not read them back; for Overpass only on an
 * empty answer, which is in the cache by the time it is judged and would fail
 * every run until it expired. A question Overpass could not answer wrote no
 * row, and the answers it did give are true — dropping them would only make the
 * next run ask the instance again.
 */
async function forgetFailed(pass: DoorPass<unknown>, error: Error, logPrefix: string): Promise<void> {
  if (pass.door.name === 'overpass' && !(error instanceof OsmEmptyAnswerError)) return;
  const dropped = await pass.forget();
  console.warn(
    `${logPrefix} Dropped ${dropped} cached OpenStreetMap answer${dropped === 1 ? '' : 's'} `
    + `${describeDoor(pass.door.name)} gave this run, so no run reads them back`,
  );
}

/**
 * The run's collection, read through one door: the preferred one, or — when
 * the preferred one is the mirror and it fails — Overpass, from the start.
 *
 * `OSM_READER=overpass` pins the public API with no fallback to the mirror: an
 * operator who chose the door with the stricter manners chose it. A fallback
 * that fails too ends the run by name with both failures.
 */
export async function readThroughOneDoor<T>(options: {
  preferred: OsmReaderName;
  pass: (door: OsmReaderName) => DoorPass<T>;
  isCancelled: () => boolean;
  logPrefix: string;
  /** Told why the mirror failed, before the second pass starts. */
  onFallback?: (why: string) => void;
}): Promise<{ result: T; door: OsmReaderName }> {
  const { preferred, logPrefix } = options;
  const first = options.pass(preferred);
  console.log(`${logPrefix} OpenStreetMap is read through ${describeDoor(preferred)}`);
  try {
    return { result: await first.read(), door: preferred };
  } catch (error) {
    if (options.isCancelled() || !isMapFailure(error)) throw error;
    await forgetFailed(first, error, logPrefix);
    if (preferred === 'overpass') throw error;
    console.warn(
      `${logPrefix} The mirror failed (${error.message}); reading OpenStreetMap again through `
      + `${describeDoor('overpass')}, from the first question`,
    );
    options.onFallback?.(error.message);
    const fallback = options.pass('overpass');
    try {
      return { result: await fallback.read(), door: 'overpass' };
    } catch (fallbackError) {
      if (options.isCancelled() || !isMapFailure(fallbackError)) throw fallbackError;
      await forgetFailed(fallback, fallbackError, logPrefix);
      throw new OsmBothDoorsFailedError(error, fallbackError);
    }
  }
}
