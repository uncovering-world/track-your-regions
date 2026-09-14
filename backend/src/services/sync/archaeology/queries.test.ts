/**
 * What this kind's three questions make of an answer: the class trees with the
 * parks taken out of the museum set, the classes and discovery place of a batch
 * of finds, and a museum pool that asks after the admitted rows no class named.
 *
 * The stub door answers on the *shape* of the question rather than on the order
 * the calls arrive in, as `worship/pipeline.test.ts` does: this module sends
 * class trees, class pools, by-id pools and the find facts, and a positional
 * stub would break on a reordering that changes nothing real.
 */

import { describe, it, expect } from 'vitest';
import {
  collectMuseumPool, fetchArchaeologyTrees, fetchFindFacts, fetchSiteFacts,
} from './queries.js';
import {
  ARCHAEOLOGICAL_PARK,
  ARTEFACT_ROOT,
  NATURAL_HISTORY_ROOT,
  SETTLEMENT_ROOT,
  SHIPWRECK_ROOT,
  SITE_ROOT,
  buildArchaeologyTrees,
} from './classes.js';
import type { QueryRunner, SparqlFn } from '../wikidataQueries.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const ENTITY = 'http://www.wikidata.org/entity/';
const ref = (qid: string) => ({ value: `${ENTITY}${qid}` });
const askedFor = (query: string): string[] => [...query.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);
const answer = (rows: SparqlBinding[]): SparqlFn => () => Promise.resolve(rows);

/** A runner over a door answering by shape, recording what it was asked and told. */
function runnerOver(door: (query: string) => SparqlBinding[]) {
  const phases: string[] = [];
  const sent: string[] = [];
  /** How many steps had been taken when each query was sent: one before every one. */
  const stepsBefore: number[] = [];
  let steps = 0;
  const run: QueryRunner = {
    sparql: (query: string) => {
      sent.push(query);
      stepsBefore.push(steps);
      return Promise.resolve(door(query));
    },
    phase: (message: string) => { phases.push(message); },
    step: () => { steps += 1; return Promise.resolve(); },
  };
  return { run, phases, sent, stepsBefore };
}

describe('fetchFindFacts', () => {
  it('groups the classes and the discovery place of every find asked about', async () => {
    // The Rosetta Stone (Q48584): a `stele` and a `bilingual inscription`,
    // found at Fort Julien — its own statements, checked on 2026-09-13.
    const rows: SparqlBinding[] = [
      { w: ref('Q48584'), cls: ref('Q178743') },
      { w: ref('Q48584'), cls: ref('Q861809') },
      { w: ref('Q48584'), disc: ref('Q3077898'), discLabel: { value: 'Fort Julien' } },
    ];
    const facts = await fetchFindFacts(answer(rows), ['Q48584', 'Q786806']);
    expect(facts.get('Q48584')).toEqual({
      classes: ['Q178743', 'Q861809'],
      discoveryPlace: { qid: 'Q3077898', label: 'Fort Julien' },
    });
    // Every asked QID gets an entry, so the rule reads a silence as "no facts"
    // rather than as a batch that failed: the Aztec sun stone, which this
    // answer says nothing about.
    expect(facts.get('Q786806')).toEqual({ classes: [], discoveryPlace: null });
  });

  it('keeps a discovery place the label service had no name for', async () => {
    // A place with no label in the eight languages comes back as its own QID.
    // It is still a place, and the find was still dug up there.
    const rows: SparqlBinding[] = [
      { w: ref('Q1'), disc: ref('Q9999999'), discLabel: { value: 'Q9999999' } },
    ];
    const facts = await fetchFindFacts(answer(rows), ['Q1']);
    expect(facts.get('Q1')?.discoveryPlace).toEqual({ qid: 'Q9999999', label: 'Q9999999' });
  });

  it('reads the discovery place as a statement that still holds', async () => {
    let sent = '';
    const sparql: SparqlFn = (query) => { sent = query; return Promise.resolve([]); };
    await fetchFindFacts(sparql, ['Q48584']);
    const flat = sent.replace(/\s+/g, ' ');
    expect(flat).toContain('?w p:P189 ?st189 . ?st189 a wikibase:BestRank ; ps:P189 ?disc . FILTER NOT EXISTS { ?st189 pq:P582 ?ended }');
    expect(flat).not.toContain('wdt:P189');
    expect(flat).toContain('?w wdt:P31 ?cls');
  });

  it('asks nothing for an empty batch', async () => {
    let asked = 0;
    const sparql: SparqlFn = () => { asked += 1; return Promise.resolve([]); };
    expect(await fetchFindFacts(sparql, [])).toEqual(new Map());
    expect(asked).toBe(0);
  });
});

describe('fetchArchaeologyTrees', () => {
  // Real edges, all of them documented in `classes.ts`: `egyptological museum`
  // is a subclass of `archaeological museum`, the museum tree reaches
  // `archaeological park`, and `Fudoki no oka` is filed under the park.
  const FUDOKI_NO_OKA = 'Q11665453';
  const TREES: Record<string, string[]> = {
    Q3329412: ['Q3329412', 'Q3330834', ARCHAEOLOGICAL_PARK, FUDOKI_NO_OKA],
    Q3330834: ['Q3330834'],
    [ARCHAEOLOGICAL_PARK]: [ARCHAEOLOGICAL_PARK, FUDOKI_NO_OKA],
    [NATURAL_HISTORY_ROOT]: [NATURAL_HISTORY_ROOT],
    [ARTEFACT_ROOT]: [ARTEFACT_ROOT],
    [SITE_ROOT]: [SITE_ROOT, 'Q1708422'],
    [SETTLEMENT_ROOT]: [SETTLEMENT_ROOT, 'Q1708422'],
    [SHIPWRECK_ROOT]: [SHIPWRECK_ROOT],
  };

  const door = (query: string): SparqlBinding[] => {
    const root = /wdt:P279\* wd:(Q\d+)/.exec(query);
    if (!root) throw new Error(`unexpected query: ${query}`);
    return (TREES[root[1]] ?? []).map((cls) => ({ c: ref(cls) }));
  };

  it('walks the seven trees, and every park class comes out of the museum set', async () => {
    const { run, phases, sent, stepsBefore } = runnerOver(door);
    const trees = await fetchArchaeologyTrees(run);

    expect(sent.map((query) => askedFor(query)[0])).toEqual([
      'Q3329412', 'Q3330834', ARCHAEOLOGICAL_PARK, NATURAL_HISTORY_ROOT, ARTEFACT_ROOT,
      SITE_ROOT, SETTLEMENT_ROOT, SHIPWRECK_ROOT,
    ]);
    expect(stepsBefore).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(phases).toEqual([
      'Reading what an archaeology museum is...',
      'Reading what an archaeological park is...',
      'Reading what a natural history museum is...',
      'Reading what an archaeological artefact is...',
      'Reading what an archaeological site is...',
      'Reading what a human settlement is...',
      'Reading what a shipwreck is...',
    ]);

    expect([...trees.museum].sort()).toEqual(['Q3329412', 'Q3330834']);
    // Not the class alone: a row typed only `Fudoki no oka` is a park too.
    expect(trees.museum.has(ARCHAEOLOGICAL_PARK)).toBe(false);
    expect(trees.museum.has(FUDOKI_NO_OKA)).toBe(false);
    expect([...trees.park].sort()).toEqual([ARCHAEOLOGICAL_PARK, FUDOKI_NO_OKA].sort());
    expect([...trees.naturalHistory]).toEqual([NATURAL_HISTORY_ROOT]);
    expect([...trees.artefact]).toEqual([ARTEFACT_ROOT]);
    // `settlement site` is under both roots, which is the ambiguity itself: it
    // is the class Wikidata gives Troy.
    expect(trees.site.has('Q1708422')).toBe(true);
    expect(trees.settlement.has('Q1708422')).toBe(true);
    expect([...trees.shipwreck]).toEqual([SHIPWRECK_ROOT]);
  });
});

describe('collectMuseumPool', () => {
  // The Louvre carries `archaeological museum` and the class pool names it; the
  // British Museum is `art museum, national museum` and no class question
  // reaches it, so an admitted British Museum has to be asked for by id or the
  // run would refuse it with the sweep's silence.
  const LOUVRE = 'Q19675';
  const BRITISH_MUSEUM = 'Q6373';
  const trees = buildArchaeologyTrees({ museum: ['Q3329412'], park: [], naturalHistory: [], artefact: [] });

  const poolRow = (qid: string, label: string): SparqlBinding => ({
    e: ref(qid), eLabel: { value: label }, sl: { value: '100' }, coord: { value: 'Point(2.3 48.8)' },
  });

  const byId: string[][] = [];
  const door = (query: string): SparqlBinding[] => {
    if (query.includes('VALUES ?cls')) {
      return askedFor(query).includes('Q3329412') ? [poolRow(LOUVRE, 'Louvre')] : [];
    }
    if (query.includes('VALUES ?e')) {
      const asked = askedFor(query);
      byId.push(asked);
      return asked.map((qid) => poolRow(qid, 'British Museum'));
    }
    throw new Error(`unexpected query: ${query}`);
  };

  it('asks the admitted rows the classes did not name by id, and no others', async () => {
    const { run, phases } = runnerOver(door);
    const pool = await collectMuseumPool(run, trees, new Set([LOUVRE, BRITISH_MUSEUM]));

    expect(byId).toEqual([[BRITISH_MUSEUM]]);
    expect(pool.get(LOUVRE)?.label).toBe('Louvre');
    expect(pool.get(BRITISH_MUSEUM)?.label).toBe('British Museum');
    expect(phases).toEqual([
      'Fetching the archaeology museum classes (batch 1/1)...',
      'Asking after admitted rows the pool did not name (batch 1/1)...',
    ]);
  });

  it('asks nothing by id when every admitted row is in the pool', async () => {
    byId.length = 0;
    const { run } = runnerOver(door);
    const pool = await collectMuseumPool(run, trees, new Set([LOUVRE]));
    expect(byId).toEqual([]);
    expect([...pool.keys()]).toEqual([LOUVRE]);
  });
});

describe('fetchSiteFacts', () => {
  it('reads the classes, the listing and the population without cross-multiplying', async () => {
    const sent: string[] = [];
    const sparql: SparqlFn = (query) => {
      sent.push(query);
      return Promise.resolve([
        { e: ref('Q29962'), cls: ref('Q515') },
        { e: ref('Q29962'), cls: ref('Q839954') },
        { e: ref('Q29962'), pop: { value: '562061' } },
        { e: ref('Q192134'), cls: ref('Q200141') },
        { e: ref('Q29317'), whc: { value: '1588' } },
        { e: ref('Q190048'), desig: ref('Q9259') },
      ]);
    };
    const facts = await fetchSiteFacts(sparql, ['Q29962', 'Q192134', 'Q29317', 'Q190048']);

    expect(sent[0]).toContain('UNION');
    expect(facts.get('Q29962')).toEqual({
      classes: ['Q515', 'Q839954'], worldHeritage: false, statesPopulation: true,
    });
    // Saqqara: a necropolis class and nobody counted.
    expect(facts.get('Q192134')).toEqual({
      classes: ['Q200141'], worldHeritage: false, statesPopulation: false,
    });
    // Bagan by its World Heritage id, Tassili n'Ajjer by its designation.
    expect(facts.get('Q29317')?.worldHeritage).toBe(true);
    expect(facts.get('Q190048')?.worldHeritage).toBe(true);
  });

  it('answers for every item asked about, so a silent batch is not a fact', async () => {
    const facts = await fetchSiteFacts(answer([]), ['Q22647']);
    expect(facts.get('Q22647')).toEqual({
      classes: [], worldHeritage: false, statesPopulation: false,
    });
  });

  it('asks nothing where there is nothing to ask about', async () => {
    let asked = 0;
    const sparql: SparqlFn = () => { asked += 1; return Promise.resolve([]); };
    expect(await fetchSiteFacts(sparql, [])).toEqual(new Map());
    expect(asked).toBe(0);
  });
});
