/**
 * Tests for the works-first museum pipeline.
 *
 * The fixture (`pipelineFixture.ts`) is a small world of works and venues, served by a stub
 * that answers on the shape of the query rather than on the order the calls arrive in: the class
 * closure walks three roots and so sends at least three queries before the pool is touched,
 * which a positional stub cannot survive. `worksCollector.test.ts` drives the same fixture
 * through the stages this pipeline composes.
 *
 * Two of the cases exist because the composition — not any single module — is where the rule can
 * go wrong, and neither module's own tests can see it: a work belongs to the *branch* two levels
 * below the institution that owns it, and a fold map chains.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { collectTier1Museums } from './pipeline.js';
import { fetchBroadPool, fetchClassPool, POOL_BANDS } from './queries.js';
import { WORKS, makeSparql, MUSEUM_CLASSES, MUSEUM_REACHABLE, PAINTING, LONG_LABEL, uri } from './pipelineFixture.js';
import type { SparqlFn } from '../wikidataQueries.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const POOL_BAND_COUNT = POOL_BANDS.length;

function run(previousPlacements: Record<string, string[]> = {}) {
  return collectTier1Museums({
    sparql: makeSparql(),
    previousPlacements,
    museumClasses: MUSEUM_CLASSES,
  });
}

describe('collectTier1Museums', () => {
  it('proposes a museum for the iconic work it holds, and names the reason', async () => {
    const out = await run();

    expect(out.items.map((i) => i.qid)).toContain('Q19675');
    const louvre = out.items.find((i) => i.qid === 'Q19675')!;
    expect(louvre.admittedFor).toEqual({ qid: 'Q12418', label: 'Mona Lisa' });
    expect(louvre.details?.museumLabel).toBe('Louvre Museum');
    expect(louvre.artworks.map((a) => a.externalId)).toEqual(['Q12418']);
    expect(louvre.artworks[0]).toMatchObject({
      name: 'Mona Lisa', treasureType: 'painting', artists: ['Leonardo da Vinci'], year: 1503,
    });
    // The whole pool is fetched, including the works that place nowhere — every work whose
    // narrow class or broad root the museum's own rule can reach, and no other kind's (a relic,
    // a future tomb): the count comes from what the rule reaches, not from the fixture's size.
    const museumReachable = Object.values(WORKS)
      .filter((w) => w.broadRoot !== undefined || MUSEUM_REACHABLE.has(w.cls));
    expect(out.fetched).toBe(museumReachable.length);
  });

  it('hands a work with two makers to the writer with both of them, in the source\'s order', async () => {
    const out = await run();

    // Shishkin painted the forest and Savitsky the bears, and which of the two a
    // reader was told used to be whichever row the endpoint answered with first.
    const pine = out.items.flatMap((i) => i.artworks).find((a) => a.externalId === 'Q900201');
    expect(pine, 'the two-maker work reached no museum').toBeDefined();
    expect(pine!.artists).toEqual(['Ivan Shishkin', 'Konstantin Savitsky']);
  });

  it('records why a venue an iconic work named was dropped', async () => {
    const out = await run();

    const church = out.filtered.find((f) => f.externalId === 'Q1876');
    expect(church).toBeDefined();
    expect(church!.name).toBe('Santa Maria delle Grazie');
    expect(church!.reason).toContain('not a museum class');
    expect(church!.reason).toContain('The Last Supper');
    // The department and the room both resolve to the Louvre, so neither is a loss.
    expect(out.filtered.map((f) => f.externalId)).not.toContain('Q3044768');
    expect(out.filtered.map((f) => f.externalId)).not.toContain('Q10292830');
  });

  it('places a work in the branch two levels below the institution that owns it', async () => {
    const out = await run();

    // P195 names the institution, P276 names the branch inside its wing. They corroborate each
    // other only if the ancestor walk is transitive; with direct parents the two statements
    // agree about nothing, the owner wins on the fallback path, and the work lands in the wrong
    // building — one level up, where placement's own tests cannot see it.
    const branch = out.items.find((i) => i.qid === 'Q900001');
    expect(branch?.artworks.map((a) => a.externalId)).toEqual(['Q900101']);
    expect(out.items.map((i) => i.qid)).not.toContain('Q900003');
  });

  it('follows a fold chain to the venue that survives it', async () => {
    const out = await run();

    // Sala folds into Galleria, which folds into Palazzo. A single lookup would leave the
    // Sala's work at the Galleria — a venue that is itself gone.
    const palazzo = out.items.find((i) => i.qid === 'Q900011');
    // The Sala's work and the Galleria's arrive alongside the Palazzo's own three.
    expect(palazzo?.artworks.map((a) => a.externalId).sort())
      .toEqual(['Q900201', 'Q900202', 'Q900203', 'Q900204', 'Q900205']);
    expect(out.items.map((i) => i.qid)).not.toContain('Q900012');
    expect(out.items.map((i) => i.qid)).not.toContain('Q900013');

    const folded = out.filtered.filter((f) => f.reason.includes('inside its P361 container'));
    expect(folded.map((f) => f.externalId).sort()).toEqual(['Q900012', 'Q900013']);
    expect(folded.find((f) => f.externalId === 'Q900013')!.reason).toContain('Galleria');
  });

  it('names the class a work was collected under as its treasure type', async () => {
    const out = await run();

    const palazzo = out.items.find((i) => i.qid === 'Q900011')!;
    const fresco = palazzo.artworks.find((a) => a.externalId === 'Q900203');
    expect(fresco?.treasureType).toBe('fresco');
  });

  it('keeps a treasure type inside the column that has to hold it', async () => {
    const out = await run();

    const palazzo = out.items.find((i) => i.qid === 'Q900011')!;
    const figurine = palazzo.artworks.find((a) => a.externalId === 'Q900204')!;
    expect(LONG_LABEL.length).toBeGreaterThan(50);
    expect(figurine.treasureType).toBe(LONG_LABEL.slice(0, 50));
    expect(figurine.treasureType.length).toBe(50);
  });

  it('does not show a reader a QID when the class has no label', async () => {
    const out = await run();

    const palazzo = out.items.find((i) => i.qid === 'Q900011')!;
    const unlabelled = palazzo.artworks.find((a) => a.externalId === 'Q900205');
    // The bare QID must neither reach the reader nor beat the broad root it was also fetched by.
    expect(unlabelled?.treasureType).toBe('painting');
  });

  it('admits every museum holding an impression of the same print', async () => {
    const out = await run();

    // Three holders of one edition, all admitted. The cap asks which of these is the one to
    // travel for, and an edition has no such answer — each impression is the thing itself.
    const holders = ['Q900401', 'Q900402', 'Q900403'];
    for (const qid of holders) {
      const museum = out.items.find((i) => i.qid === qid);
      expect(museum, `${qid} should be admitted`).toBeDefined();
      expect(museum!.admittedFor).toEqual({ qid: 'Q900250', label: 'The Great Print' });
    }
  });

  it('asks Wikidata for the four roots no closure reaches from a painting', async () => {
    const sparql = makeSparql();
    await collectTier1Museums({ sparql, previousPlacements: {}, museumClasses: MUSEUM_CLASSES });

    // Drawing, print, mosaic and tapestry are not kinds of painting, sculpture or statue, so
    // nothing under those three reaches them. They were measured in the dry run and lost on the
    // way into the pipeline, and the catalogue held zero prints until they came back.
    const asked = sparql.mock.calls.map((c) => String(c[0])).join('\n');
    for (const root of ['Q93184', 'Q11060274', 'Q133067', 'Q184296']) {
      expect(asked, `root ${root} was never fetched`).toContain(root);
    }
  });

  it('asks for the collection classes that are not kinds of work at all', async () => {
    const sparql = makeSparql();
    await collectTier1Museums({ sparql, previousPlacements: {}, museumClasses: MUSEUM_CLASSES });

    // A painting series and a group of casts hold works rather than being one, so they sit
    // outside every subclass tree — which is where Monet's Water Lilies, Van Gogh's Sunflowers
    // and Rodin's Thinker live.
    const asked = sparql.mock.calls.map((c) => String(c[0])).join('\n');
    expect(asked).toContain('Q15727816');
    expect(asked).toContain('Q28890616');
  });

  it('admits nobody for a work below the threshold, or for one held too widely', async () => {
    const out = await run();
    const admitted = out.items.map((i) => i.qid);

    // 20 sitelinks is above the release floor and below the join threshold: the venue holding
    // only that work is not a top art museum.
    expect(admitted).not.toContain('Q900311');
    // A work three venues own admits none of them.
    expect(admitted).not.toContain('Q900301');
    expect(admitted).not.toContain('Q900302');
    expect(admitted).not.toContain('Q900303');
  });

  it('reports what moved since the previous run, and what the pool no longer offers', async () => {
    const out = await run({
      Q12418: ['Q19675'],
      Q900101: ['Q900003'],
      Q555555: ['Q19675'],
    });

    expect(out.diff.moved).toEqual([{ work: 'Q900101', from: ['Q900003'], to: ['Q900001'] }]);
    expect(out.diff.dropped).toEqual(['Q555555']);
  });

  it('proposes the palace a collection is housed in, reached only through the collection\'s location', async () => {
    const out = await run();

    // La velata names the Galleria Palatina and nothing else, so the palace enters the graph
    // only because the collection's own `P276` is followed — and it is the palace, better known
    // and five metres away, that a traveller buys a ticket to (#781).
    const pitti = out.items.find((i) => i.qid === 'Q29286');
    expect(pitti?.artworks.map((a) => a.externalId)).toEqual(['Q948034']);
    expect(pitti?.admittedFor).toEqual({ qid: 'Q948034', label: 'La velata' });
    expect(out.items.map((i) => i.qid)).not.toContain('Q866498');

    const palatina = out.filtered.find((f) => f.externalId === 'Q866498');
    expect(palatina?.reason).toContain('folded into Palazzo Pitti');
    expect(palatina?.reason).toContain('housed in');
  });

  it('reports the collection that folded, not the door the walk went on from', async () => {
    const out = await run();

    // The work ends at the palace, two doors up. The collection lost its row and is reported;
    // the gallery between them holds no work, was never a candidate, and must not appear as
    // one — a line about it would bump the filtered count and put a building the run never
    // proposed on the curation screen.
    const palace = out.items.find((i) => i.qid === 'Q900023');
    expect(palace?.artworks.map((a) => a.externalId)).toEqual(['Q900601']);
    expect(out.items.map((i) => i.qid)).not.toContain('Q900021');
    expect(out.items.map((i) => i.qid)).not.toContain('Q900022');

    const filtered = out.filtered.map((f) => f.externalId);
    expect(filtered).toContain('Q900021');
    expect(filtered).not.toContain('Q900022');
  });

  it('refuses a museum whose famous works cannot be seen, and names them (#868)', async () => {
    const out = await run();

    // The Gardner holds two iconic works, both stolen in 1990: one a lost painting whose
    // collection is unknown, the other with an unknown location. Neither admits it.
    expect(out.items.map((i) => i.qid)).not.toContain('Q49135');
    expect(out.filtered).toContainEqual({
      externalId: 'Q49135',
      name: 'Isabella Stewart Gardner Museum',
      reason: 'its famous works cannot be seen — The Storm on the Sea of Galilee (whereabouts unknown), '
        + 'The Concert (whereabouts unknown)',
    });
    const linked = out.items.flatMap((i) => i.artworks.map((a) => a.externalId));
    expect(linked).not.toContain('Q2246489');
    expect(linked).not.toContain('Q1169395');
  });

  it('does not tell a venue the art test would refuse that its works cannot be seen', async () => {
    const out = await run();

    // The MuseumsQuartier holds a work of unknown whereabouts and nothing else of ours; it is
    // an editorial exclusion, so the reason it is out is that one, not the missing work.
    const quarter = out.filtered.filter((f) => f.externalId === 'Q699943');
    expect(quarter.map((f) => f.reason).join(' ')).not.toContain('cannot be seen');
  });

  it('judges the loss on what the venue would hold whole, not on the unseen work alone', async () => {
    const out = await run();

    // The Hall of Casts carries no art class. With its two statues beside the painting nobody
    // can see, the painting share says it is not an art museum; judged on the painting alone it
    // would be one, and would be told its famous works cannot be seen.
    expect(out.items.map((i) => i.qid)).not.toContain('Q900901');
    const hall = out.filtered.filter((f) => f.externalId === 'Q900901');
    expect(hall.map((f) => f.reason).join(' ')).not.toContain('cannot be seen');
  });

  it('folds the counterfactual as the run would, so a collection in an admitted palace is no loss', async () => {
    const out = await run();

    // The Collection of Lost Things holds one work nobody can see and stands in the Palace of
    // Doors, which the run admits. As if seen, the work folds into the palace with the
    // collection; the palace lost a work, not its place, and the collection — a name the
    // catalogue never uses — is not refused for it.
    expect(out.items.map((i) => i.qid)).toContain('Q900023');
    expect(out.filtered.map((f) => f.externalId)).not.toContain('Q900031');
  });

  it('links no lost artwork, though the closure typed it a painting', async () => {
    const out = await run();

    const palazzo = out.items.find((i) => i.qid === 'Q900011');
    expect(palazzo, 'the Palazzo reached no museum').toBeDefined();
    expect(palazzo!.artworks.map((a) => a.externalId)).not.toContain('Q2395137');
    // The Palazzo itself is not reported: it is admitted for the works it still shows.
    expect(out.filtered.map((f) => f.externalId)).not.toContain('Q900011');
  });

  it('keeps a destroyed work whose remains are on show, by name', async () => {
    const out = await run();

    const capitoline = out.items.find((i) => i.qid === 'Q333906');
    expect(capitoline, 'the Capitoline reached no museum').toBeDefined();
    expect(capitoline!.artworks.map((a) => a.externalId)).toContain('Q1289781');
  });

  it('leaves a work whose owner is merely anonymous where it hangs', async () => {
    const out = await run();

    const capitoline = out.items.find((i) => i.qid === 'Q333906');
    expect(capitoline!.artworks.map((a) => a.externalId)).toContain('Q152849');
  });

  it('keeps a museum under its own name when the quarter it stands in is an editorial exclusion', async () => {
    const out = await run();

    // The MuseumsQuartier is typed an art museum, is better known than the Leopold Museum and
    // lies 78 m away — and it is excluded by name for having swallowed the Leopold before. An
    // excluded entity is not a door: the museum stays, with its work.
    const leopold = out.items.find((i) => i.qid === 'Q59435');
    expect(leopold?.artworks.map((a) => a.externalId)).toEqual(['Q1445107']);
    expect(out.items.map((i) => i.qid)).not.toContain('Q699943');
    expect(out.filtered.map((f) => f.externalId)).not.toContain('Q59435');
  });
});

describe('pool truncation', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  const rows = (n: number): SparqlBinding[] =>
    Array.from({ length: n }, (_, i) => ({
      w: uri(`Q${1000 + i}`), wLabel: { value: `Work ${i}` }, sl: { value: '30' },
    }));

  /** A runner that counts its steps, which is where a cancelled run would throw. */
  const runner = (sparql: SparqlFn) => {
    const phases: string[] = [];
    let steps = 0;
    return {
      run: { sparql, phase: (m: string) => { phases.push(m); }, step: async () => { steps += 1; } },
      phases,
      steps: () => steps,
    };
  };

  it('stops the run when a band comes back holding exactly its LIMIT', async () => {
    const { run } = runner(vi.fn(async () => rows(2)));

    // Fatal, not a warning. The pool decides which museums this source admits
    // (ADR-0024), so a pool cut off at its limit withdraws real museums and
    // calls the run a success — and with no ORDER BY inside a band, the rows
    // that survive are an arbitrary subset rather than the famous ones.
    await expect(fetchBroadPool(run, { qid: PAINTING, type: 'painting' }, 2))
      .rejects.toThrow(/LIMIT of 2/);
  });

  it('names the band it stopped on, so the next edit is obvious', async () => {
    const { run } = runner(vi.fn(async () => rows(2)));

    await expect(fetchBroadPool(run, { qid: PAINTING, type: 'painting' }, 2))
      .rejects.toThrow(/100\+ sitelinks/);
  });

  it('stops a truncated narrow-class batch too', async () => {
    const sparql = vi.fn(async () => rows(2));

    await expect(fetchClassPool(sparql, ['Q1476300'], 2)).rejects.toThrow(/narrow classes/);
  });

  it('asks one question per fame band, and merges them by work', async () => {
    // The same work in two answers is one work: bands do not overlap, but a class
    // query can reach the same painting, and the merge is what stops the pool's
    // own length lying to the admission rule that reads it.
    const sparql = vi.fn(async (_query: string, _descriptor?: { label: string }) => rows(1));
    const { run } = runner(sparql);

    const works = await fetchBroadPool(run, { qid: PAINTING, type: 'painting' }, 2);

    expect(sparql).toHaveBeenCalledTimes(POOL_BAND_COUNT);
    const filters = sparql.mock.calls.map(call => String(call[0]));
    expect(filters[0]).toContain('FILTER(?sl >= 100)');
    expect(filters[1]).toContain('FILTER(?sl >= 50 && ?sl < 100)');
    // The hint is the whole reason a band is answerable: without the fixed join
    // order the planner scans the class again, which is what timed out.
    expect(filters[0]).toContain('hint:optimizer "None"');
    expect(filters[0]).toContain('hint:rangeSafe true');
    // Every band is its own cached question, which is what lets a run that dies
    // in the fourth band keep the first three.
    const labels = sparql.mock.calls.map(call => call[1]?.label);
    expect(new Set(labels).size).toBe(POOL_BAND_COUNT);
    expect(works).toHaveLength(1);
  });

  it('paces and reports between bands, not only between roots', async () => {
    const { run, phases, steps } = runner(vi.fn(async () => rows(1)));

    await fetchBroadPool(run, { qid: PAINTING, type: 'painting' }, 2);

    // Each band is tens of seconds of somebody's afternoon: a Cancel pressed in
    // the middle of a root has to be acted on before the next band, and the
    // phase message has to move, or the run reads as hung.
    expect(steps()).toBe(POOL_BAND_COUNT);
    expect(new Set(phases).size).toBe(POOL_BAND_COUNT);
    expect(phases[0]).toContain('band 1/');
  });

  it('is content when the band fits', async () => {
    const { run } = runner(vi.fn(async () => rows(1)));
    await expect(fetchBroadPool(run, { qid: PAINTING, type: 'painting' }, 2)).resolves.toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('asks a batch of narrow classes once, without bands', async () => {
    // Narrow classes were never the query that failed, and banding them would
    // turn thirty affordable questions into two hundred.
    const sparql = vi.fn(async (_query: string) => rows(1));
    await fetchClassPool(sparql, ['Q1476300', 'Q93184'], 2);
    expect(sparql).toHaveBeenCalledTimes(1);
    expect(String(sparql.mock.calls[0][0])).toContain('VALUES ?cls');
  });
});
