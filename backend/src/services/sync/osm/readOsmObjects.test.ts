/**
 * The batched read on a fake door: how it slices, paces and reports, and how
 * it files what came back — none of which may depend on which door answered.
 */
import { describe, it, expect, vi } from 'vitest';
import { OSM_BATCH, readOsmObjects, type OsmDoor } from './readOsmObjects.js';
import type { KeepWkt, OsmObject } from './types.js';
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
      { name: 'overpass', question, send: async () => [] },
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
