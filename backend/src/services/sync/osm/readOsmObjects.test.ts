/**
 * Both reads on a fake door — the batched per-item one and the enumeration:
 * how they slice, pace and report, what they refuse to read as a fact, and how
 * they file what came back — none of which may depend on which door answered.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  OSM_BATCH, OsmEmptyAnswerError, OsmEmptyEnumerationError, readOsmDigs, readOsmObjects, type OsmDoor,
} from './readOsmObjects.js';
import type { DigTags, KeepWkt, OsmObject } from './types.js';
import type { SparqlFn } from '../wikidataQueries.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const KEEP: KeepWkt = {
  historic: ['archaeological_site', 'ruins'],
  manMade: ['tell'],
  boundary: ['protected_area', 'national_park'],
};

const runner = () => {
  const phases: string[] = [];
  let steps = 0;
  return {
    run: { phase: (m: string) => { phases.push(m); }, step: async () => { steps += 1; } },
    phases,
    stepCount: () => steps,
  };
};

/** A door whose question is the items themselves, so a test can read them back. */
function door(send: SparqlFn): OsmDoor & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    name: 'qlever',
    asked,
    question: (qids) => {
      asked.push([...qids]);
      return qids.join(' ');
    },
    digsQuestions: () => [''],
    send,
  };
}

describe('readOsmObjects', () => {
  it('asks in batches of a hundred, pausing before each, and reports the batch', async () => {
    const send = vi.fn<SparqlFn>(async () => [] as SparqlBinding[]);
    const qids = Array.from({ length: OSM_BATCH + 5 }, (_, i) => `Q${i + 1}`);
    const { run, phases, stepCount } = runner();
    const through = door(send);

    const answer = await readOsmObjects(through, qids, KEEP, run);

    expect(send).toHaveBeenCalledTimes(2);
    expect(through.asked[0]).toHaveLength(OSM_BATCH);
    expect(through.asked[1]).toHaveLength(5);
    expect(stepCount()).toBe(2);
    expect(phases).toEqual([
      'Asking OpenStreetMap what it maps at each site (batch 1/2)...',
      'Asking OpenStreetMap what it maps at each site (batch 2/2)...',
    ]);
    // Every item asked about has an entry: an empty list is "OSM maps nothing
    // carrying this item", and absence would be "nobody asked".
    expect(answer.size).toBe(OSM_BATCH + 5);
    expect(answer.get('Q1')).toEqual([]);
  });

  it('hands the door the keep rule with every question', async () => {
    const question = vi.fn((qids: string[]) => qids.join(' '));
    const { run } = runner();
    await readOsmObjects(
      { name: 'overpass', question, digsQuestions: () => [''], send: async () => [] },
      ['Q22647'], KEEP, run,
    );
    expect(question).toHaveBeenCalledWith(['Q22647'], KEEP);
  });

  it('files the answer under the cache kind of its own, with a label a person reads', async () => {
    const send = vi.fn<SparqlFn>(async () => [] as SparqlBinding[]);
    const { run } = runner();
    await readOsmObjects(door(send), ['Q22647'], KEEP, run);
    expect(send.mock.calls[0][1]).toEqual({
      kind: 'osm', label: 'OSM objects of 1 item',
    });
  });

  it('groups what came back under the item that was asked about', async () => {
    const send = async (): Promise<SparqlBinding[]> => [{
      q: { value: 'Q22647' },
      s: { value: 'https://www.openstreetmap.org/way/423938794' },
      type: { value: 'https://www.openstreetmap.org/way' },
      geomType: { value: 'POLYGON((26.' },
      wkt: { value: 'POLYGON((26.2 39.9,26.3 39.9,26.3 40.0,26.2 39.9))' },
      historic: { value: 'archaeological_site' },
    }];
    const { run } = runner();
    const answer = await readOsmObjects(door(send), ['Q22647', 'Q1524'], KEEP, run);
    const troy = answer.get('Q22647') as OsmObject[];
    expect(troy[0].ref).toBe('way/423938794');
    expect(troy[0].tags.historic).toBe('archaeological_site');
    expect(answer.get('Q1524')).toEqual([]);
  });

  it('asks nothing at all where the caller has no items', async () => {
    const send = vi.fn<SparqlFn>(async () => [] as SparqlBinding[]);
    const { run } = runner();
    expect(await readOsmObjects(door(send), [], KEEP, run)).toEqual(new Map());
    expect(send).not.toHaveBeenCalled();
  });
});

/**
 * The enumeration (#895): every object OSM tags as a dig or as ruins, in one
 * question, filed under the item it carries — or, where it carries only an
 * article, under that article, for the pool to resolve.
 */
describe('readOsmDigs', () => {
  const DIGS: DigTags = { historic: ['archaeological_site', 'ruins'], keys: ['archaeological_site', 'ruins'] };
  const object = (id: string) => ({ value: `https://www.openstreetmap.org/${id}` });

  it('asks once, and files each object under its item or its article', async () => {
    const rows: SparqlBinding[] = [
      // Ajanta: the way carries the item and says archaeological_site.
      { q: { value: 'Q184427' }, s: object('way/115567314'), historic: { value: 'archaeological_site' }, name: { value: 'Ajanta Caves' } },
      // Nemrut's tumulus: the way carries only the Turkish article.
      { wp: { value: 'tr:Nemrut Dağı' }, s: object('way/1069114387'), historic: { value: 'archaeological_site' } },
      // Two rows about one object (a key with two values) are one object.
      { q: { value: 'Q31565' }, s: object('way/28969503'), historic: { value: 'archaeological_site' }, archaeological_site: { value: 'city' } },
      { q: { value: 'Q31565' }, s: object('way/28969503'), historic: { value: 'archaeological_site' }, ruins: { value: 'yes' } },
      // A row naming nothing the reader files by is dropped.
      { s: object('node/1'), historic: { value: 'ruins' } },
    ];
    const send = vi.fn<SparqlFn>(async () => rows);
    const { run, phases, stepCount } = runner();
    const through: OsmDoor = { name: 'qlever', question: () => '', digsQuestions: (tags) => [JSON.stringify(tags)], send };

    const digs = await readOsmDigs(through, DIGS, run);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(JSON.stringify(DIGS));
    expect(stepCount()).toBe(1);
    expect(phases).toEqual(['Asking OpenStreetMap for every dig and ruin it maps (question 1/1)...']);
    expect([...digs.byItem.keys()].sort()).toEqual(['Q184427', 'Q31565']);
    expect(digs.byItem.get('Q184427')).toEqual([{
      ref: 'way/115567314', kind: 'way',
      tags: { historic: 'archaeological_site', name: 'Ajanta Caves' },
      geometryType: null, wkt: null,
    }]);
    expect(digs.byItem.get('Q31565')).toHaveLength(1);
    expect(digs.byItem.get('Q31565')?.[0].tags).toEqual({
      historic: 'archaeological_site', archaeological_site: 'city', ruins: 'yes',
    });
    expect([...digs.byArticle.keys()]).toEqual(['tr:Nemrut Dağı']);
    expect(digs.byArticle.get('tr:Nemrut Dağı')?.[0].ref).toBe('way/1069114387');
  });

  it('refuses an answer with nothing in it rather than reading it as an empty map', async () => {
    // The empty answer is in the cache by the time this throws, so the class
    // is the one the run's boundary forgets the cached OSM answers on — a
    // plain Error would leave the silence to be re-read for a day.
    const send = vi.fn<SparqlFn>(async () => [] as SparqlBinding[]);
    const { run } = runner();
    const through: OsmDoor = { name: 'qlever', question: () => '', digsQuestions: () => [''], send };
    const failed = readOsmDigs(through, DIGS, run);
    await expect(failed).rejects.toThrow(/answered with no dig at all/);
    await expect(failed).rejects.toBeInstanceOf(OsmEmptyEnumerationError);
    await expect(failed).rejects.toBeInstanceOf(OsmEmptyAnswerError);
  });

  it('folds an answer far larger than a call may take arguments', async () => {
    // The mirror answers the whole planet in one question — 66,417 rows on
    // 2026-09-15 — and a spread into `push` is one argument per row, which
    // Node ends at about 124,000 with a `RangeError` naming nothing about
    // OpenStreetMap. The map only grows, so the rows are appended rather than
    // spread, and this pins the reader against the ceiling with room over it.
    const rows: SparqlBinding[] = Array.from({ length: 200_000 }, (_, i) => ({
      q: { value: `Q${i + 1}` },
      s: object(`node/${i + 1}`),
      historic: { value: 'archaeological_site' },
    }));
    const { run } = runner();
    const through: OsmDoor = { name: 'qlever', question: () => '', digsQuestions: () => [''], send: async () => rows };

    const digs = await readOsmDigs(through, DIGS, run);

    expect(digs.byItem.size).toBe(200_000);
  });

  it('asks a door that splits the enumeration one question at a time, pausing before each', async () => {
    // Overpass answers the enumeration as one question per selector: a
    // planet-wide tag read does not fit its budget whole (2026-09-15).
    const send = vi.fn<SparqlFn>(async (query: string) => (query === 'a'
      ? [{ q: { value: 'Q184427' }, s: object('way/115567314'), historic: { value: 'archaeological_site' } }]
      : [{ q: { value: 'Q272153' }, s: object('way/196493741'), ruins: { value: 'yes' } }]));
    const { run, phases, stepCount } = runner();
    const through: OsmDoor = { name: 'overpass', question: () => '', digsQuestions: () => ['a', 'b'], send };

    const digs = await readOsmDigs(through, DIGS, run);

    expect(send.mock.calls.map((call) => call[0])).toEqual(['a', 'b']);
    expect(stepCount()).toBe(2);
    expect(phases).toEqual([
      'Asking OpenStreetMap for every dig and ruin it maps (question 1/2)...',
      'Asking OpenStreetMap for every dig and ruin it maps (question 2/2)...',
    ]);
    expect([...digs.byItem.keys()].sort()).toEqual(['Q184427', 'Q272153']);
  });
});
