/**
 * The venue-side read (#890) over the shared fixture: what an admitted venue
 * holds that no class question asked for, kept by the pool's own vocabulary or
 * by a kind's keep rule, placed as a pool work is placed, and refused with the
 * classes a person would need to widen the pool.
 */

import { describe, it, expect } from 'vitest';
import { keptElsewhere, readVenueSide, refusedHoldingReason } from './venueSide.js';
import {
  collectWorks, MUSEUM_BROAD_ROOTS, MUSEUM_WHOLE_ROOTS, MUSEUM_PINNED_CLASSES,
  MUSEUM_PINNED_EDITION_CLASSES, EDITION_ROOT, type WorksCollectorOptions,
} from './worksCollector.js';
import { museumRule } from './venueTest.js';
import { makeSparql, MUSEUM_CLASSES, FILM, SIDE_CLASS } from './pipelineFixture.js';

const ART: WorksCollectorOptions = {
  broadRoots: MUSEUM_BROAD_ROOTS, wholeRoots: MUSEUM_WHOLE_ROOTS, pinned: MUSEUM_PINNED_CLASSES,
  pinnedEditionClasses: MUSEUM_PINNED_EDITION_CLASSES, editionRoot: EDITION_ROOT,
  noun: { work: 'work of art', works: 'artworks' },
  rule: museumRule(MUSEUM_CLASSES), logPrefix: '[test]',
};
const LOUVRE = 'Q19675';
const PITTI = 'Q29286';

async function read(opts: WorksCollectorOptions = ART, admitted = [LOUVRE, PITTI]) {
  const sparql = makeSparql();
  const phases: string[] = [];
  const run = { sparql, phase: (m: string) => phases.push(m), step: async () => {} };
  const collection = await collectWorks(run, opts);
  const out = await readVenueSide(run, collection, opts, { admitted });
  return { ...out, before: collection, sparql, phases };
}

describe('readVenueSide', () => {
  it('keeps what carries a class the pool asked for, and types it by that class', async () => {
    const { collection, kept, before } = await read();
    // Never in the pool: its own class is one no museum root reaches.
    expect(before.pool.has('Q900951')).toBe(false);
    expect(kept.get('Q900951')).toMatchObject({ label: 'Fresco Nobody Asked For', type: 'fresco', typeQid: 'Q1476300' });
    expect(collection.pool.get('Q900951')?.type).toBe('fresco');
    expect(collection.afterFolds.Q900951).toEqual([LOUVRE]);
    // Everything the pool held is still there, placed where it was.
    expect(collection.afterFolds.Q12418).toEqual(before.afterFolds.Q12418);
  });

  it('refuses what carries no such class, with its classes and its holder named', async () => {
    const { collection, refused } = await read();
    const film = refused.find((r) => r.qid === 'Q900950');
    expect(film).toEqual({
      qid: 'Q900950', label: 'Film in the Collection', sitelinks: 30,
      classes: [{ qid: FILM, label: 'film' }], heldBy: [LOUVRE],
    });
    expect(collection.pool.has('Q900950')).toBe(false);
    expect(refusedHoldingReason(film!, ART.noun, (qid) => collection.graph.details.get(qid)?.label ?? qid))
      .toBe('not a work of art by its classes: film (Q11424) — held by Louvre Museum');
  });

  it('asks about a venue folded into an admitted one, and places its object at the survivor', async () => {
    const { collection, kept } = await read();
    // The Galleria Palatina folds into Palazzo Pitti; the fresco names the Galleria.
    expect(collection.folds.Q866498?.into).toBe(PITTI);
    expect(kept.has('Q900952')).toBe(true);
    expect(collection.placed.Q900952).toEqual(['Q866498']);
    expect(collection.afterFolds.Q900952).toEqual([PITTI]);
  });

  it('reads no venue the kind did not admit, and nothing below the floor', async () => {
    const { sparql, kept, refused } = await read(ART, [LOUVRE]);
    const holdings = sparql.mock.calls.map((c) => String(c[0])).filter((q) => q.includes('VALUES ?venue'));
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toContain(`wd:${LOUVRE}`);
    expect(holdings[0]).not.toContain(`wd:${PITTI}`);
    expect(holdings[0]).toContain('FILTER(?sl >= 10)');
    expect(kept.has('Q900952')).toBe(false);
    expect(kept.has('Q900954')).toBe(false);
    expect(refused.map((r) => r.qid)).not.toContain('Q900954');
  });

  it('asks nothing again about an object the pool already holds', async () => {
    const { sparql, counts } = await read();
    // The Mona Lisa is the Louvre's and in the pool: held, counted, not re-read.
    expect(counts.alreadyInPool).toBeGreaterThan(0);
    const byId = sparql.mock.calls.map((c) => String(c[0])).filter((q) => q.includes('OPTIONAL { ?w wdt:P31 ?cls }'));
    expect(byId.some((q) => q.includes('wd:Q12418'))).toBe(false);
    expect(byId.some((q) => q.includes('wd:Q900951'))).toBe(true);
  });

  it('places a kept object nobody can see nowhere, by the lost tree on its own classes', async () => {
    const { collection, kept } = await read();
    expect(kept.has('Q900953')).toBe(true);
    expect(collection.afterFolds.Q900953).toEqual([]);
    expect(collection.unseen.Q900953).toEqual({ reason: 'lost painting', wouldBe: [LOUVRE] });
  });

  it('hands the objects to a kind\'s own keep rule and facts, with the venue read already', async () => {
    const asked: string[][] = [];
    const opts: WorksCollectorOptions = {
      ...ART,
      noun: { work: 'find', works: 'finds' },
      workFacts: async (_run, qids) => {
        asked.push(qids);
        return new Map(qids.map((qid) => [qid, { classes: [], discoveryPlace: qid === 'Q900950' ? { qid: 'Q1', label: 'a dig' } : null }]));
      },
      keep: (_work, facts) => facts?.discoveryPlace !== null && facts?.discoveryPlace !== undefined,
    };
    const { kept, refused, facts } = await read(opts);
    // The pool's own keep ran first and kept nothing; the venue-side objects are
    // judged by the same rule, with the facts the kind reads merged in.
    expect(asked.at(-1)).toContain('Q900950');
    expect(facts.get('Q900950')?.classes).toEqual([FILM]);
    expect(kept.has('Q900950')).toBe(true);
    expect(refused.map((r) => r.qid)).toContain('Q900951');
    expect(refused.find((r) => r.qid === 'Q900951')?.classes.map((c) => c.qid)).toEqual([SIDE_CLASS, 'Q1476300']);
  });

  it('names a refusal only above the report line, and counts the rest', async () => {
    const sparql = makeSparql();
    const run = { sparql, phase: () => {}, step: async () => {} };
    const collection = await collectWorks(run, ART);
    // The film is at 30 sitelinks: named at a line of 18, only counted at one of 40.
    const named = await readVenueSide(run, collection, ART, { admitted: [LOUVRE], reportFloor: 18 });
    expect(named.reported.map((r) => r.qid)).toEqual(['Q900950']);
    const counted = await readVenueSide(run, collection, ART, { admitted: [LOUVRE], reportFloor: 40 });
    expect(counted.reported).toEqual([]);
    expect(counted.refused.map((r) => r.qid)).toEqual(['Q900950']);
    // What is kept is kept whatever the report line says.
    expect(counted.kept.has('Q900951')).toBe(true);
  });

  it('names what it kept and the kind then wrote nowhere, at the report line', async () => {
    const { collection, ...rest } = await read();
    const side = { ...rest, collection } as Parameters<typeof keptElsewhere>[0];
    // What the kind writes: the folded placements at its admitted museums.
    const current: Record<string, string[]> = {};
    for (const qid of collection.pool.keys()) {
      current[qid] = (collection.afterFolds[qid] ?? []).filter((v: string) => [LOUVRE, PITTI].includes(v));
    }
    // The lost fresco was kept by class and placed nowhere: it is the one
    // kept object the run writes nowhere, and it carries its classes and its
    // holder for the report. The two frescoes the run writes are not named.
    expect(keptElsewhere(side, current)).toEqual([{
      qid: 'Q900953', label: 'Lost Fresco of the Louvre', sitelinks: 22,
      classes: [
        { qid: SIDE_CLASS, label: 'wall decoration' }, { qid: 'Q1476300', label: 'fresco' },
        { qid: 'Q104438958', label: 'lost painting' },
      ],
      heldBy: [LOUVRE],
    }]);
    // Below the report line it is counted, not named.
    expect(keptElsewhere({ ...side, reportFloor: 30 }, current)).toEqual([]);
  });

  it('skips what the pool\'s own keep refused, as it skips what the pool kept', async () => {
    const opts: WorksCollectorOptions = {
      ...ART,
      noun: { work: 'find', works: 'finds' },
      // The pool keeps nothing that carries `painting`: the Mona Lisa is
      // collected and refused, and must not be fetched by id and refused again
      // from the Louvre's side.
      workFacts: async (_run, qids) => new Map(qids.map((qid) => [qid, { classes: [], discoveryPlace: null }])),
      keep: (work) => work.typeQid !== 'Q3305213',
    };
    const { sparql, refused, before } = await read(opts);
    expect(before.refusedByKeep.has('Q12418')).toBe(true);
    expect(refused.map((r) => r.qid)).not.toContain('Q12418');
    const byId = sparql.mock.calls.map((c) => String(c[0])).filter((q) => q.includes('OPTIONAL { ?w wdt:P31 ?cls }'));
    expect(byId.some((q) => q.includes('wd:Q12418'))).toBe(false);
  });

  it('says what it is doing in the phase lines', async () => {
    const { phases } = await read();
    expect(phases.some((p) => p.startsWith('Reading what each admitted venue holds'))).toBe(true);
    expect(phases.some((p) => p.startsWith('Asking what each object found from the venue\'s side is'))).toBe(true);
  });
});
