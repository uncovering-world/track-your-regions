/**
 * The archaeology museums as one run against a fake door: the class trees, the
 * museum pool, the finds those museums hold, and what the two signals of
 * ADR-0058 decision 2 make of each museum together.
 *
 * The world and the door are `pipelineFixture.ts`, which says which of its rows
 * are real and which are the fixture's own.
 */

import { describe, it, expect, vi } from 'vitest';
import { collectArchaeologyMuseums, type CollectedArchaeology } from './pipeline.js';
import {
  answer,
  categoryDoor,
  world,
  ART_MUSEUM,
  MUSEUM,
  NATIONAL_MUSEUM,
  type World,
} from './pipelineFixture.js';
import type { SourceLine } from '../sourceLine.js';

const LINE: SourceLine = {
  enterSitelinks: 22, staySitelinks: 18, find: { enterSitelinks: 18, staySitelinks: 15 },
};

function collect(w: World, opts: {
  line?: SourceLine; admitted?: string[]; previousPlacements?: Record<string, string[]>;
} = {}): Promise<CollectedArchaeology> {
  return collectArchaeologyMuseums({
    sparql: (query: string) => Promise.resolve(answer(w, query)),
    previousPlacements: opts.previousPlacements ?? {},
    admitted: new Set(opts.admitted ?? []),
    line: opts.line ?? LINE,
    categories: categoryDoor(w).categories,
  });
}

const item = (out: CollectedArchaeology, qid: string) => out.items.find((i) => i.qid === qid);
const reason = (out: CollectedArchaeology, qid: string) =>
  out.filtered.find((f) => f.externalId === qid)?.reason;
const treasuresOf = (out: CollectedArchaeology, qid: string) =>
  (item(out, qid)?.treasures ?? []).map((t) => t.externalId);

describe('collectArchaeologyMuseums', () => {
  it('admits the Louvre for its class and the British Museum for the category the class misses', async () => {
    const out = await collect(world());

    expect(item(out, 'Q19675')).toMatchObject({
      type: 'museum',
      label: 'Louvre Museum',
      description: 'art and archeology museum in Paris, France',
      countryLabel: 'France',
      website: 'https://www.louvre.fr',
      sitelinks: 169,
      nature: 'archaeological',
      natureWhy: 'class: archaeological museum',
      admissionNote: null,
    });
    // Admitted for what it is: nothing it holds had to say so, and this
    // fixture's Louvre holds no find at all.
    expect(item(out, 'Q19675')?.admittedFor).toBeUndefined();
    expect(treasuresOf(out, 'Q19675')).toEqual([]);

    expect(item(out, 'Q6373')).toMatchObject({
      nature: 'archaeological',
      natureWhy: 'category: Archaeological museums in London',
      sitelinks: 109,
      categories: ['Archaeological museums in London', 'Art museums and galleries in London'],
    });
    expect(item(out, 'Q6373')?.classes).toEqual([ART_MUSEUM, NATIONAL_MUSEUM, MUSEUM]);
    expect(item(out, 'Q6373')?.admittedFor).toBeUndefined();
  });

  it('writes the Rosetta Stone as a treasure that says where it was dug up', async () => {
    const out = await collect(world());

    expect(treasuresOf(out, 'Q6373')).toEqual(['Q48584']);
    expect(item(out, 'Q6373')?.treasures[0]).toMatchObject({
      name: 'Rosetta Stone',
      treasureType: 'stele',
      sitelinksCount: 101,
      foundAt: { qid: 'Q3077898', label: 'Fort Julien' },
    });
  });

  it('admits the Delphi museum below the place line for the Charioteer, and names it', async () => {
    const out = await collect(world());

    // 15 sitelinks against a place line of 22: what carries it over is one find
    // above the finds' own line (ADR-0058 decision 2).
    expect(item(out, 'Q636928')).toMatchObject({
      sitelinks: 15,
      nature: 'archaeological',
      natureWhy: 'category: Archaeological museums in Greece',
      admittedFor: { qid: 'Q1230882', label: 'Charioteer of Delphi' },
    });
    expect(treasuresOf(out, 'Q636928')).toEqual(['Q1230882']);
  });

  it('holds the Hermitage for a curator: an antiquities department, not a nature', async () => {
    const out = await collect(world());

    const hermitage = item(out, 'Q132783');
    expect(hermitage).toMatchObject({
      nature: 'department',
      natureWhy: 'category: Egyptological collections in Russia',
      sitelinks: 86,
    });
    expect(hermitage?.admissionNote).toContain('an antiquities department');
    expect(hermitage?.admissionNote).toContain('is the exposition substantially archaeology?');
    // Held is admitted: it arrives with the find it holds, for the curator to
    // read beside the question.
    expect(treasuresOf(out, 'Q132783')).toEqual(['Q2513086']);
    // Its own 86 articles carried it over the line; no find had to.
    expect(hermitage?.admittedFor).toBeUndefined();
  });

  it('names the museums it held and the museums a find carried, not only their counts', async () => {
    // A dry run writes nothing, so these two lists exist nowhere but the log:
    // counted alone, the held museums are open questions nobody can see and the
    // museums admitted for a find are ADR-0058 decision 2 unread. Asserted on
    // the Hermitage, which is held, and on Delphi, which is in for the
    // Charioteer and nothing else.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await collect(world());

    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines.find((line) => line.includes('held:'))).toContain('Hermitage Museum');
    expect(lines.find((line) => line.includes('for a find:')))
      .toContain('Delphi Archaeological Museum (Charioteer of Delphi)');
    log.mockRestore();
  });

  it('refuses the Uffizi, whose one famous find does not make it an archaeology museum', async () => {
    const out = await collect(world());

    expect(item(out, 'Q51252')).toBeUndefined();
    expect(reason(out, 'Q51252'))
      .toBe('not an archaeology museum by category or class (1 famous find held)');
  });

  it('names no museum the rules never ran on', async () => {
    const out = await collect(world());

    // Only the museums the pool typed archaeological and the holders of a find
    // above the line are judged, so the long tail produces no refusals at all:
    // the Uffizi, which a rule refused, and the Pio-Clementino, which folded
    // into the Vatican Museums — and nothing else.
    expect(out.filtered.map((f) => f.externalId)).toEqual(['Q51252', 'Q1439912']);
    // Two museums the class question named, five finds: seven entities.
    expect(out.fetched).toBe(7);
  });

  it('keeps a fold onto a department held for a curator, and reports what it lost', async () => {
    const out = await collect(world());

    // The Pio-Clementino is housed in the Vatican Museums, the better-known name
    // 86 m away, and they are one ticket. The Vatican's article carries
    // `Museums of ancient Greece` — a department, held for a curator and still a
    // museum this kind admits — so the fold stands and the Laocoön is shown
    // under the name a traveller is looking for.
    expect(treasuresOf(out, 'Q182955')).toEqual(['Q465762']);
    expect(item(out, 'Q182955')?.nature).toBe('department');
    expect(item(out, 'Q182955')?.admissionNote).toContain('an antiquities department');
    expect(item(out, 'Q1439912')).toBeUndefined();
    expect(reason(out, 'Q1439912')).toContain('folded into Vatican Museums');
    expect(reason(out, 'Q1439912')).toContain('86 m away');
  });

  it('keeps a fold onto a survivor whose only signal is the category', async () => {
    // The canon the class misses is admitted by the editorial category alone —
    // the British Museum, the Pergamon, the Bardo, Naples — and such a museum is
    // as good a survivor as any other. The Vatican Museums stand in for it here:
    // no archaeological class, one nature category, and the fold holds.
    const w = world();
    w.museums.Q182955.categories = ['Archaeological museums in Vatican City'];
    const out = await collect(w);

    expect(item(out, 'Q182955')).toMatchObject({
      nature: 'archaeological',
      natureWhy: 'category: Archaeological museums in Vatican City',
      admissionNote: null,
    });
    expect(treasuresOf(out, 'Q182955')).toEqual(['Q465762']);
    expect(item(out, 'Q1439912')).toBeUndefined();
  });

  it('drops a fold onto a museum this kind does not admit, and judges the collection instead', async () => {
    // An art museum with no archaeological signal at all: the fold rule knows
    // nothing about archaeology and would still hand it the Laocoön. The fold is
    // dropped, and the collection that is the archaeology stands on its own —
    // the Pio-Clementino has no English article, so the editorial signal is
    // silent and its class is the whole of the answer (ADR-0058's consequences
    // name that price).
    const w = world();
    w.museums.Q182955.categories = [];
    const out = await collect(w);

    expect(item(out, 'Q1439912')).toMatchObject({
      categories: [],
      nature: 'archaeological',
      natureWhy: 'class: archaeological museum',
      sitelinks: 10,
      admittedFor: { qid: 'Q465762', label: 'Laocoön and His Sons' },
    });
    expect(item(out, 'Q1439912')?.treasures[0]).toMatchObject({
      name: 'Laocoön and His Sons', foundAt: { qid: 'Q220', label: 'Rome' },
    });
    expect(reason(out, 'Q1439912')).toBeUndefined();
    // And the museum the fold would have handed it to is judged by nothing: it
    // is not in the pool and holds no find of ours, so no rule ran on it.
    expect(item(out, 'Q182955')).toBeUndefined();
    expect(reason(out, 'Q182955')).toBeUndefined();
  });

  it('asks Wikidata what a museum is only where the venue graph cannot say', async () => {
    const w = world();
    const facts: string[] = [];
    await collectArchaeologyMuseums({
      sparql: (query: string) => {
        // The classes-and-containers question, which is the one this run sends
        // about a museum (`fetchEntityFacts`).
        if (query.includes('?coll')) facts.push(query);
        return Promise.resolve(answer(w, query));
      },
      previousPlacements: {},
      admitted: new Set<string>(),
      line: LINE,
      categories: categoryDoor(w).categories,
    });

    // One batch, and it holds the Louvre: no find points at it, so the venue
    // graph never loaded it. The British Museum is a venue and its classes came
    // with the graph — asking again would be the same fact bought twice.
    expect(facts).toHaveLength(1);
    expect(facts[0]).toContain('wd:Q19675');
    expect(facts[0]).not.toContain('wd:Q6373');
  });

  it('keeps a museum whose find slipped, where the source already admits it', async () => {
    // The finds' line is hysteretic too. Delphi is in the tier for the
    // Charioteer; at 17 articles the Charioteer is below the finds' enter line
    // of 18 and above their stay line of 15, so a museum the source admits keeps
    // it — and one it has never admitted does not get in on it.
    const w = world();
    w.finds.Q1230882.sitelinks = 17;

    const kept = await collect(w, { admitted: ['Q636928'] });
    expect(kept.items.find((i) => i.qid === 'Q636928')).toMatchObject({
      sitelinks: 15,
      admittedFor: { qid: 'Q1230882', label: 'Charioteer of Delphi' },
    });

    const out = await collect(w);
    expect(item(out, 'Q636928')).toBeUndefined();
    // Never admitted and below the place line: out, not refused by name.
    expect(reason(out, 'Q636928')).toBeUndefined();
  });

  it('asks English Wikipedia once for the articles of the museums it judges', async () => {
    const w = world();
    const door = categoryDoor(w);
    await collectArchaeologyMuseums({
      sparql: (query: string) => Promise.resolve(answer(w, query)),
      previousPlacements: {},
      admitted: new Set<string>(),
      line: LINE,
      categories: door.categories,
    });

    expect(door.calls).toHaveLength(1);
    expect([...door.calls[0]].sort()).toEqual([
      'British Museum', 'Delphi Archaeological Museum', 'Hermitage Museum', 'Louvre',
      'Uffizi', 'Vatican Museums',
    ]);
  });

  it('keeps an admitted museum that slipped to the stay band and refuses one below it by name', async () => {
    const slipped = world();
    slipped.museums.Q19675.sitelinks = 20;
    expect(item(await collect(slipped, { admitted: ['Q19675'] }), 'Q19675')).toBeDefined();

    const fallen = world();
    fallen.museums.Q19675.sitelinks = 17;
    const out = await collect(fallen, { admitted: ['Q19675'] });
    expect(item(out, 'Q19675')).toBeUndefined();
    expect(reason(out, 'Q19675'))
      .toBe("17 sitelinks: below the world tier's line (22 to enter, 18 to stay)");

    // The same museum at the same count that the source never admitted is
    // simply out: no rule ran on it, so no refusal is reported.
    const unknown = await collect(fallen);
    expect(item(unknown, 'Q19675')).toBeUndefined();
    expect(reason(unknown, 'Q19675')).toBeUndefined();
  });

  it('names no find for a museum its own hysteresis kept, and names one where it did not', async () => {
    // The Zeugma Mosaic Museum at 20 articles sits in the band between the place
    // line's stay (18) and enter (22), holding the Pompeii Lakshmi at 19 — above
    // the finds' enter line of 18. Two runs, two different reasons it is here.
    const held = (w: World) => {
      w.finds.Q24269542.statements = [{ property: 'P195', venue: 'Q196982' }];
      return w;
    };

    // Already admitted: what keeps it is its own 20 languages, the place line
    // forgiving the slip exactly as it forgives the Louvre's in the test above.
    // Naming a find here would tell a curator the museum is in the catalogue for
    // a mosaic when nothing it holds is what kept it.
    const kept = await collect(held(world()), { admitted: ['Q196982'] });
    expect(item(kept, 'Q196982')).toMatchObject({ sitelinks: 20, findsAboveLine: 1 });
    expect(item(kept, 'Q196982')?.admittedFor).toBeUndefined();

    // Never admitted: 20 is below the enter line with no standing to forgive it,
    // so the find is what carries it over and the card says so (ADR-0058
    // decision 2).
    const carried = await collect(held(world()));
    expect(item(carried, 'Q196982')).toMatchObject({
      sitelinks: 20,
      admittedFor: { qid: 'Q24269542', label: 'Pompeii Lakshmi' },
    });
  });

  it('says where the finds it writes have moved since the last run', async () => {
    const out = await collect(world(), { previousPlacements: { Q48584: ['Q999'] } });

    expect(out.diff.moved).toEqual([{ work: 'Q48584', from: ['Q999'], to: ['Q6373'] }]);
  });
});
