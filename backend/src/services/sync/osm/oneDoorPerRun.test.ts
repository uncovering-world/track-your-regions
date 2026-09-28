/**
 * One door per run, on fake transports: the mirror failing at the first batch,
 * at the seventh and at the answer-share floor each end in one full read
 * through Overpass, from its first question; a mirror that answers never
 * touches Overpass; a run pinned to Overpass never touches the mirror; and
 * what is not about the map ends the run as it always did.
 *
 * The pass is the reads themselves — the enumeration, then the per-item read
 * in batches — through `readOsmDigs` and `readOsmObjects`, so the failure is
 * raised where a real run raises it.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  OSM_BATCH, OsmDoorFailedError, OsmEmptyEnumerationError, readOsmDigs, readOsmObjects,
  type OsmDoor, type OsmReaderName,
} from './readOsmObjects.js';
import { OsmBothDoorsFailedError, readThroughOneDoor, type DoorPass } from './oneDoorPerRun.js';
import { OsmAnswerFloorError } from '../archaeology/sites.js';
import type { DigTags, KeepWkt } from './types.js';
import type { SparqlFn } from '../wikidataQueries.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const KEEP: KeepWkt = { historic: ['archaeological_site'], manMade: [], boundary: [] };
const TAGS: DigTags = { historic: ['archaeological_site'], keys: ['ruins'] };
/** Seven batches' worth of candidates. */
const QIDS = Array.from({ length: OSM_BATCH * 7 }, (_, i) => `Q${i + 1}`);
const run = { phase: () => {}, step: async () => {} };

/** A row for every item asked, so a read answers about all of them. */
function everyItem(query: string): SparqlBinding[] {
  return query.startsWith('batch ')
    ? query.slice('batch '.length).split(' ').map((qid) => ({
      q: { value: qid }, s: { value: `https://www.openstreetmap.org/way/${qid.slice(1)}` },
    }))
    : [{ q: { value: 'Q22647' }, s: { value: 'https://www.openstreetmap.org/way/1' } }];
}

/**
 * A fake door: its questions are readable, and `fail` says which of them the
 * transport loses — the enumeration is question 0, batch n is question n.
 */
function fakeDoor(name: OsmReaderName, fail: (question: number) => boolean = () => false) {
  let asked = 0;
  const questions: string[] = [];
  const send = vi.fn<SparqlFn>(async (query) => {
    const index = asked;
    asked += 1;
    questions.push(query);
    if (fail(index)) throw new Error(`${name} 503, and the wait is spent`);
    return everyItem(query);
  });
  const door: OsmDoor = {
    name,
    question: (qids) => `batch ${qids.join(' ')}`,
    digsQuestions: () => ['digs'],
    send,
  };
  return { door, send, questions };
}

/**
 * The run's collection through one door: the enumeration, the per-item read,
 * and the floor where a test asks for it — what `collectSitesByFame` does, in
 * that order.
 */
function passOver(
  door: OsmDoor,
  options: { floorFails?: boolean } = {},
): DoorPass<{ door: OsmReaderName; items: number }> & { forget: ReturnType<typeof vi.fn> } {
  return {
    door,
    forget: vi.fn(async () => 3),
    read: async () => {
      await readOsmDigs(door, TAGS, run);
      const objects = await readOsmObjects(door, QIDS, KEEP, run);
      if (options.floorFails) throw new OsmAnswerFloorError(QIDS.length, 12);
      return { door: door.name, items: objects.size };
    },
  };
}

function oneDoor(
  preferred: OsmReaderName,
  passes: Record<OsmReaderName, ReturnType<typeof passOver>>,
  isCancelled = () => false,
) {
  const pass = vi.fn((name: OsmReaderName) => passes[name]);
  const onFallback = vi.fn();
  const read = readThroughOneDoor({ preferred, pass, isCancelled, logPrefix: '[T]', onFallback });
  return { read, pass, onFallback };
}

/** Every question one full read asks: the enumeration, then all seven batches from the first. */
function isOneFullRead(questions: string[]): void {
  expect(questions).toHaveLength(8);
  expect(questions[0]).toBe('digs');
  expect(questions[1]).toBe(`batch ${QIDS.slice(0, OSM_BATCH).join(' ')}`);
  expect(questions[7]).toBe(`batch ${QIDS.slice(OSM_BATCH * 6).join(' ')}`);
}

describe('readThroughOneDoor', () => {
  it.each([
    ['at the first batch', 1],
    ['at the seventh batch', 7],
  ])('reads the whole map again through Overpass when the mirror fails %s', async (_, lost) => {
    const mirror = fakeDoor('qlever', (question) => question === lost);
    const overpass = fakeDoor('overpass');
    const passes = { qlever: passOver(mirror.door), overpass: passOver(overpass.door) };
    const { read, onFallback } = oneDoor('qlever', passes);

    const { result, door } = await read;

    expect(door).toBe('overpass');
    expect(result).toEqual({ door: 'overpass', items: QIDS.length });
    // The mirror was asked up to the question it lost and no further.
    expect(mirror.send).toHaveBeenCalledTimes(lost + 1);
    isOneFullRead(overpass.questions);
    // What the mirror answered this run is dropped before the second pass, and
    // what Overpass answered is kept.
    expect(passes.qlever.forget).toHaveBeenCalledTimes(1);
    expect(passes.overpass.forget).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining('could not be read through qlever'));
  });

  it('reads the whole map again through Overpass when the mirror answers under the floor', async () => {
    const mirror = fakeDoor('qlever');
    const overpass = fakeDoor('overpass');
    const passes = {
      qlever: passOver(mirror.door, { floorFails: true }),
      overpass: passOver(overpass.door),
    };
    const { door } = await oneDoor('qlever', passes).read;
    expect(door).toBe('overpass');
    isOneFullRead(mirror.questions);
    isOneFullRead(overpass.questions);
    expect(passes.qlever.forget).toHaveBeenCalledTimes(1);
  });

  it('reads the whole map again through Overpass when the mirror knows no dig at all', async () => {
    const mirror = fakeDoor('qlever');
    const overpass = fakeDoor('overpass');
    const passes = { qlever: passOver(mirror.door), overpass: passOver(overpass.door) };
    passes.qlever.read = async () => { throw new OsmEmptyEnumerationError(); };
    const { door } = await oneDoor('qlever', passes).read;
    expect(door).toBe('overpass');
    isOneFullRead(overpass.questions);
  });

  it('never touches Overpass when the mirror answers', async () => {
    const mirror = fakeDoor('qlever');
    const overpass = fakeDoor('overpass');
    const passes = { qlever: passOver(mirror.door), overpass: passOver(overpass.door) };
    const { read, pass } = oneDoor('qlever', passes);
    expect((await read).door).toBe('qlever');
    expect(pass).toHaveBeenCalledTimes(1);
    expect(overpass.send).not.toHaveBeenCalled();
    expect(passes.qlever.forget).not.toHaveBeenCalled();
  });

  it('never touches the mirror on a run pinned to Overpass, and does not fall back from it', async () => {
    const mirror = fakeDoor('qlever');
    const overpass = fakeDoor('overpass', (question) => question === 3);
    const passes = { qlever: passOver(mirror.door), overpass: passOver(overpass.door) };
    const { read, pass } = oneDoor('overpass', passes);

    await expect(read).rejects.toBeInstanceOf(OsmDoorFailedError);
    expect(pass.mock.calls.map(([name]) => name)).toEqual(['overpass']);
    expect(mirror.send).not.toHaveBeenCalled();
    // A question Overpass could not answer wrote nothing, and what it did answer is true.
    expect(passes.overpass.forget).not.toHaveBeenCalled();
  });

  it('drops what Overpass answered when its answer was too empty to judge by', async () => {
    const overpass = fakeDoor('overpass');
    const passes = {
      qlever: passOver(fakeDoor('qlever').door),
      overpass: passOver(overpass.door, { floorFails: true }),
    };
    await expect(oneDoor('overpass', passes).read).rejects.toBeInstanceOf(OsmAnswerFloorError);
    expect(passes.overpass.forget).toHaveBeenCalledTimes(1);
  });

  it('ends the run naming both failures when the fallback fails too', async () => {
    const mirror = fakeDoor('qlever', (question) => question === 2);
    const overpass = fakeDoor('overpass', (question) => question === 5);
    const passes = { qlever: passOver(mirror.door), overpass: passOver(overpass.door) };
    const read = oneDoor('qlever', passes).read;
    await expect(read).rejects.toBeInstanceOf(OsmBothDoorsFailedError);
    await expect(read).rejects.toThrow(
      /either door — the mirror: .*qlever 503.*; Overpass, on the fallback: .*overpass 503/,
    );
  });

  it('lets a failure that is not about the map end the run, with no second pass', async () => {
    const passes = {
      qlever: passOver(fakeDoor('qlever').door),
      overpass: passOver(fakeDoor('overpass').door),
    };
    passes.qlever.read = async () => { throw new Error('Wikidata 500, and the wait is spent'); };
    const { read, pass } = oneDoor('qlever', passes);
    await expect(read).rejects.toThrow('Wikidata 500');
    expect(pass).toHaveBeenCalledTimes(1);
    expect(passes.qlever.forget).not.toHaveBeenCalled();
  });

  it('stops rather than falling back when the run was cancelled', async () => {
    const mirror = fakeDoor('qlever', (question) => question === 1);
    const passes = { qlever: passOver(mirror.door), overpass: passOver(fakeDoor('overpass').door) };
    const { read, pass } = oneDoor('qlever', passes, () => true);
    await expect(read).rejects.toBeInstanceOf(OsmDoorFailedError);
    expect(pass).toHaveBeenCalledTimes(1);
  });
});
