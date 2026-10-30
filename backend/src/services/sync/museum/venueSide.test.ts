/**
 * The venue-side read (#890) over the shared fixture: what an admitted venue
 * holds that no class question asked for, kept by the pool's own vocabulary or
 * by a kind's keep rule, placed as a pool work is placed, and refused with the
 * classes a person would need to widen the pool.
 */

import { describe, it, expect } from 'vitest';
import { keptElsewhere, readVenueSide, refusedHoldingReason, type HandOver } from './venueSide.js';
import type { ArticleHoldingsReader } from './articleHoldings.js';
import {
  collectWorks, MUSEUM_BROAD_ROOTS, MUSEUM_WHOLE_ROOTS, MUSEUM_PINNED_CLASSES,
  MUSEUM_PINNED_EDITION_CLASSES, EDITION_ROOT, type WorksCollectorOptions,
} from './worksCollector.js';
import { museumRule } from './venueTest.js';
import { makeSparql, MUSEUM_CLASSES, FILM, SIDE_CLASS, SITE } from './pipelineFixture.js';

const ART: WorksCollectorOptions = {
  broadRoots: MUSEUM_BROAD_ROOTS, wholeRoots: MUSEUM_WHOLE_ROOTS, pinned: MUSEUM_PINNED_CLASSES,
  pinnedEditionClasses: MUSEUM_PINNED_EDITION_CLASSES, editionRoot: EDITION_ROOT,
  noun: { work: 'work of art', works: 'artworks' },
  rule: museumRule(MUSEUM_CLASSES), logPrefix: '[test]',
};
const LOUVRE = 'Q19675';
const PITTI = 'Q29286';

async function read(
  opts: WorksCollectorOptions = ART, admitted = [LOUVRE, PITTI], handedOver?: ReadonlyMap<string, HandOver>,
  articleHoldings?: ArticleHoldingsReader,
) {
  const sparql = makeSparql();
  const phases: string[] = [];
  const run = { sparql, phase: (m: string) => phases.push(m), step: async () => {} };
  const collection = await collectWorks(run, opts);
  const shelfPlace = (classes: ReadonlyMap<string, string>) => classes.has(SITE);
  const out = await readVenueSide(run, collection, opts, { admitted, handedOver, articleHoldings, shelfPlace });
  return { ...out, before: collection, sparql, phases };
}

describe('readVenueSide, what English Wikipedia files in a venue\'s collection (ADR-0166)', () => {
  // The Louvre's shelf names the tablet, which Wikidata places nowhere, and the
  // fresco, which Wikidata already places at the Louvre.
  const shelf: ArticleHoldingsReader = (_run, venues) => Promise.resolve(
    venues.some((venue) => venue.qid === LOUVRE)
      ? ['Q900955', 'Q900956', 'Q900951', 'Q900957', 'Q900958', 'Q900959']
        .map((work) => ({ work, venue: LOUVRE, property: 'P276' as const, sitelinks: 0, via: 'wikipedia' as const }))
      : [],
  );

  it('never meets a work Wikidata places nowhere, without the article holdings, and says nothing of who placed the rest', async () => {
    const { collection } = await read();
    expect(collection.pool.has('Q900955')).toBe(false);
    expect(collection.pool.get('Q12418')?.placedBy).toBeUndefined();
  });

  it('places the work at the venue by a statement Wikipedia makes, and marks it so', async () => {
    const asked: string[][] = [];
    const { collection, kept } = await read(ART, [LOUVRE, PITTI], undefined, (run, venues) => {
      asked.push(venues.map((venue) => venue.qid));
      return shelf(run, venues);
    });
    // Asked once, of the admitted venues and their fold sources.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(LOUVRE);
    expect(kept.get('Q900955')).toMatchObject({ type: 'fresco' });
    expect(collection.pool.get('Q900955')?.placedBy).toBe('wikipedia');
    expect(collection.afterFolds.Q900955).toEqual([LOUVRE]);
    expect(collection.statements.get('Q900955')).toEqual([
      { work: 'Q900955', venue: LOUVRE, property: 'P276', rank: 'normal', via: 'wikipedia' },
    ]);
    // A shelf names its works with no floor; the read holds them to the pool's.
    expect(collection.pool.has('Q900956')).toBe(false);
    // A place a shelf files beside its fragments is no holding: the kind's place test keeps it out.
    expect(collection.pool.has('Q900958')).toBe(false);
    // A pool work Wikidata places nowhere is placed by the shelf too, and marked.
    expect(collection.pool.get('Q900957')?.placedBy).toBe('wikipedia');
    expect(collection.afterFolds.Q900957).toEqual([LOUVRE]);
    expect(collection.statements.get('Q900957')?.[0]?.via).toBe('wikipedia');
    // A pool work the kind calls a place is not placed by the shelf either.
    expect(collection.pool.get('Q900959')?.placedBy).toBeNull();
    expect(collection.afterFolds.Q900959 ?? []).toEqual([]);
    // Where Wikidata places the work, its word stands and the article adds nothing;
    // the run read the shelves, so it says so, and a stored mark goes.
    expect(collection.pool.get('Q900951')?.placedBy).toBeNull();
    expect(collection.pool.get('Q12418')?.placedBy).toBeNull();
    expect(collection.statements.get('Q900951')?.some((s) => s.via)).toBe(false);
  });
});

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
    expect(kept.has('Q900955')).toBe(false);
    expect(refused.map((r) => r.qid)).not.toContain('Q900955');
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

  describe('a work another kind handed over (ADR-0102)', () => {
    const handedTo = (heldIn: string[]): ReadonlyMap<string, HandOver> => new Map([[
      'Q900950', { by: 'Public art', reason: 'inside Louvre Museum: a work of a museum, not public art', heldIn },
    ]]);

    it('keeps a holding handed over at this venue, whatever its classes, and says who handed it', async () => {
      const { collection, kept, refused } = await read(ART, [LOUVRE, PITTI], handedTo(['Q1', LOUVRE]));
      expect(refused.map((r) => r.qid)).not.toContain('Q900950');
      expect(collection.afterFolds.Q900950).toEqual([LOUVRE]);
      const named = 'Public art: inside Louvre Museum: a work of a museum, not public art';
      expect(kept.get('Q900950')?.handedBy).toBe(named);
      expect(collection.pool.get('Q900950')?.handedBy).toBe(named);
    });

    it('keeps nothing handed over to a place this read did not find it at', async () => {
      const { kept, refused } = await read(ART, [LOUVRE, PITTI], handedTo(['Q1', PITTI]));
      expect(kept.has('Q900950')).toBe(false);
      expect(refused.map((r) => r.qid)).toContain('Q900950');
    });

    it('places a handed-over work only at a place the refusal named, a venue folded into it included', async () => {
      // A rule that keeps no fresco: the one the Galleria Palatina holds is refused by its classes.
      const opts: WorksCollectorOptions = { ...ART, keep: (work) => work.typeQid !== 'Q1476300' };
      const fresco = (heldIn: string[]): ReadonlyMap<string, HandOver> => new Map([[
        'Q900952', { by: 'Public art', reason: 'inside Palazzo Pitti: a work of a museum, not public art', heldIn },
      ]]);
      const atPitti = await read(opts, [LOUVRE, PITTI], fresco([PITTI]));
      expect(atPitti.collection.placed.Q900952).toEqual(['Q866498']);
      expect(atPitti.collection.afterFolds.Q900952).toEqual([PITTI]);
      // Named only where the read never finds it: not handed over at all.
      const elsewhere = await read(opts, [LOUVRE, PITTI], fresco([LOUVRE]));
      expect(elsewhere.kept.has('Q900952')).toBe(false);
    });

    it('places a handed-over work at the venue the refusal named, not at another admitted venue its statements reach', async () => {
      // The Great Print is in three museums' collections; the refusal named the first.
      const opts: WorksCollectorOptions = { ...ART, keep: (work) => work.qid !== 'Q900250' };
      const print: ReadonlyMap<string, HandOver> = new Map([[
        'Q900250', { by: 'Public art', reason: 'in the collection of Print Museum A: a work of a museum', heldIn: ['Q900401'] },
      ]]);
      const { collection, kept } = await read(opts, ['Q900401', 'Q900402', 'Q900403'], print);
      expect(kept.get('Q900250')?.handedBy).toBeDefined();
      expect(collection.placed.Q900250).toEqual(['Q900401']);
    });

    it('asks again about what an earlier round refused, once it is handed over at this round\'s venue', async () => {
      const sparql = makeSparql();
      const run = { sparql, phase: () => {}, step: async () => {} };
      const collection = await collectWorks(run, ART);
      const out = await readVenueSide(run, collection, ART, {
        admitted: [LOUVRE], skip: new Set(['Q900950']), handedOver: handedTo([LOUVRE]),
      });
      expect(out.kept.get('Q900950')?.handedBy).toContain('Public art');
      const unhanded = await readVenueSide(run, collection, ART, { admitted: [LOUVRE], skip: new Set(['Q900950']) });
      expect(unhanded.kept.has('Q900950')).toBe(false);
      expect(unhanded.refused.map((r) => r.qid)).not.toContain('Q900950');
    });

    it('places a pool work its statements place at no admitted venue at the admitted venue the refusal named (#1557)', async () => {
      // The Bamberg Horseman's shape: in the pool, its own statements reach no venue
      // the kind admits (the cathedral's P576 dissolution), the refusal names one.
      const atPitti: ReadonlyMap<string, HandOver> = new Map([[
        'Q12418', { by: 'Public art', reason: 'inside Palazzo Pitti: a work of a museum, not public art', heldIn: [PITTI] },
      ]]);
      const { before, collection } = await read(ART, [PITTI], atPitti);
      expect(before.pool.has('Q12418')).toBe(true);
      expect(collection.afterFolds.Q12418).toEqual([PITTI]);
      // It says so on the venue's changeset, as a work the read kept for a hand-over does.
      expect(collection.pool.get('Q12418')?.handedBy)
        .toBe('Public art: inside Palazzo Pitti: a work of a museum, not public art');
      // A work its statements already place at an admitted venue stays there.
      const both = await read(ART, [LOUVRE, PITTI], atPitti);
      expect(both.collection.afterFolds.Q12418).toEqual([LOUVRE]);
      // And a refusal that names no admitted venue places nothing.
      const nowhere = await read(ART, [PITTI], new Map([[
        'Q12418', { by: 'Public art', reason: 'inside Louvre Museum: a work of a museum, not public art', heldIn: [LOUVRE] },
      ]]));
      expect(nowhere.collection.afterFolds.Q12418 ?? []).not.toContain(PITTI);
      // A venue folded into an admitted one is that venue: the Galleria Palatina is Palazzo Pitti's.
      const folded = await read(ART, [PITTI], new Map([[
        'Q12418', { by: 'Public art', reason: 'inside the Galleria Palatina: a work of a museum', heldIn: ['Q866498'] },
      ]]));
      expect(folded.collection.afterFolds.Q12418).toEqual([PITTI]);
    });

    it('leaves a handed-over pool work nobody can see unseen (#1557)', async () => {
      const { before } = await read(ART, [PITTI]);
      const lost = Object.keys(before.unseen).find((qid) => before.pool.has(qid));
      expect(lost).toBeDefined();
      const { collection } = await read(ART, [PITTI], new Map([[
        lost!, { by: 'Public art', reason: 'inside Palazzo Pitti: a work of a museum, not public art', heldIn: [PITTI] },
      ]]));
      expect(collection.unseen[lost!]).toBeDefined();
      expect(collection.afterFolds[lost!] ?? []).toEqual([]);
    });

    it("asks again about what the pool's own keep refused, once it is handed over here", async () => {
      const opts: WorksCollectorOptions = {
        ...ART,
        noun: { work: 'find', works: 'finds' },
        workFacts: async (_run, qids) => new Map(qids.map((qid) => [qid, { classes: [], discoveryPlace: null }])),
        keep: (work) => work.typeQid !== 'Q3305213',
      };
      const monaLisa: ReadonlyMap<string, HandOver> = new Map([[
        'Q12418', { by: 'Public art', reason: 'inside Louvre Museum: a work of a museum, not public art', heldIn: [LOUVRE] },
      ]]);
      const { before, kept } = await read(opts, [LOUVRE, PITTI], monaLisa);
      expect(before.refusedByKeep.has('Q12418')).toBe(true);
      expect(kept.get('Q12418')?.handedBy).toContain('Public art');
    });
  });

  it('says what it is doing in the phase lines', async () => {
    const { phases } = await read();
    expect(phases.some((p) => p.startsWith('Reading what each admitted venue holds'))).toBe(true);
    expect(phases.some((p) => p.startsWith('Asking what each object found from the venue\'s side is'))).toBe(true);
  });
});
