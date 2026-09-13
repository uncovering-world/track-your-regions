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
  ARCHAEOLOGICAL_MUSEUM,
  ART_MUSEUM,
  MUSEUM,
  NATIONAL_MUSEUM,
  PALACE,
  type World,
} from './pipelineFixture.js';
import type { SourceLine } from '../sourceLine.js';

const LINE: SourceLine = {
  enterSitelinks: 22, staySitelinks: 18, find: { enterSitelinks: 18, staySitelinks: 15 },
};

function collect(w: World, opts: {
  line?: SourceLine; admitted?: string[]; previousPlacements?: Record<string, string[]>;
} = {}): Promise<CollectedArchaeology> {
  const door = categoryDoor(w);
  return collectArchaeologyMuseums({
    sparql: (query: string) => Promise.resolve(answer(w, query)),
    previousPlacements: opts.previousPlacements ?? {},
    admitted: new Set(opts.admitted ?? []),
    line: opts.line ?? LINE,
    categories: door.categories,
    categoryMembers: door.categoryMembers,
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

  it('admits the Bardo, which nothing but the category walk names', async () => {
    // `museum` on Wikidata and no find of ours: no class question names it, no
    // find carries it, and read only of candidates the category would never be
    // asked about it at all. The walk is the door (ADR-0058 decision 2).
    const out = await collect(world());

    expect(item(out, 'Q1429003')).toMatchObject({
      type: 'museum',
      label: 'Bardo National Museum',
      countryLabel: 'Tunisia',
      sitelinks: 35,
      classes: [MUSEUM],
      nature: 'archaeological',
      natureWhy: 'category: Archaeological museums in Tunisia',
      admissionNote: null,
      lat: 36.80944,
      lon: 10.13444,
    });
    // Its own 35 articles carried it over the line, and it holds nothing this
    // run knows about: admitted for what it is, as the decision says.
    expect(item(out, 'Q1429003')?.admittedFor).toBeUndefined();
    expect(treasuresOf(out, 'Q1429003')).toEqual([]);
  });

  it('sends Pompeii to the site door, because Wikidata does not call it a museum', async () => {
    // Wikipedia files the dig itself under `Archaeological museums in Italy`,
    // and nothing else refuses it: `archaeological site, ancient city` is not
    // in the park tree the veto reads, and the category answers the nature
    // question before the class is ever asked. Admitted, it would be a museum
    // pin on an ancient city of 122 languages. The class pool and the finds
    // carry museums by the road they came in on; a row here by the category
    // alone has to be a museum on Wikidata too.
    const out = await collect(world());

    expect(item(out, 'Q43332')).toBeUndefined();
    expect(reason(out, 'Q43332')).toBe(
      'no museum class on Wikidata: a site, a castle or a city in Wikipedia\'s category '
      + '— the site door\'s',
    );
    // And a find that names the dig as where it stands does not excuse it. The
    // venue graph holds every entity a work's `P276` points at, refused venues
    // included, so "the graph knows it" is not one of the roads a museum comes
    // in by: the Pompeii Lakshmi is placed nowhere and Pompeii is still asked
    // whether Wikidata calls it a museum.
    expect(out.items.some((i) => i.treasures.some((t) => t.externalId === 'Q24269542'))).toBe(false);
  });

  it('refuses an archaeological park the shelf named, as a site rather than a museum', async () => {
    // The class gate cannot turn this one away: Wikidata files `archaeological
    // park` under `archaeological museum` and so under `museum`, so Hadrian's
    // Villa passes `isMuseumOnWikidata` and reaches the nature rule carrying a
    // museum class. The park veto is the only thing between it and a museum pin
    // on an open-air site a traveller walks for an afternoon (#887). Named
    // rather than dropped, because at 52 articles it is worth the site door's
    // worklist.
    const out = await collect(world());

    expect(item(out, 'Q272777')).toBeUndefined();
    expect(reason(out, 'Q272777')).toBe('an archaeological park: a site, not a museum');
  });

  it('says nothing about a site under the line, whose name would be one of hundreds', async () => {
    // Mactaris is on the same shelf as the Bardo and known in 7 languages. The
    // 27 sites above the place line are a worklist for the site door; the rest
    // of a country's archaeology, named one by one, is the long tail that
    // buries the refusals a curator actually reads — the same silence in a
    // louder voice.
    const out = await collect(world());

    expect(item(out, 'Q3485394')).toBeUndefined();
    expect(reason(out, 'Q3485394')).toBeUndefined();
  });

  it('does not judge a member Wikidata answers about without an English article', async () => {
    // The walk found the article and the row came back without the sitelink.
    // There are no categories to read of an article the row does not have, so
    // the museum would fall to its bare `museum` class and be refused by name
    // for a fact nobody stated. A data oddity is not a verdict.
    const out = await collect(world());

    expect(item(out, 'Q1109031')).toBeUndefined();
    expect(reason(out, 'Q1109031')).toBeUndefined();
  });

  it('leaves a member below the place line out, and says nothing about it', async () => {
    const out = await collect(world());

    // The Zeugma Mosaic Museum is filed under `Archaeological museums in
    // Turkey` and known in 20 languages against a line of 22. The category is a
    // door, not a line of its own: a member the source never admitted and the
    // world has not heard enough of is out, and naming it would bury the
    // refusals a curator reads under every museum in sixty countries.
    expect(item(out, 'Q196982')).toBeUndefined();
    expect(reason(out, 'Q196982')).toBeUndefined();
  });

  it('asks Wikidata about the members no pool of this run already carries', async () => {
    const w = world();
    const byId: string[] = [];
    const door = categoryDoor(w);
    await collectArchaeologyMuseums({
      // The by-id pool question asked about the members, which names itself in
      // the line the panel shows (`fetchEntitiesByIds`).
      sparql: (query: string, descriptor?: { label: string }) => {
        if (descriptor?.label.startsWith('museums the categories name')) byId.push(query);
        return Promise.resolve(answer(w, query));
      },
      previousPlacements: {},
      admitted: new Set<string>(),
      line: LINE,
      categories: door.categories,
      categoryMembers: door.categoryMembers,
    });

    // Seven members, three of them already known: Delphi is in the class pool,
    // the British Museum is a venue of the graph and Pompeii is in the graph as
    // the place a find names — and a fact bought twice is a query this run did
    // not need to send. Being known is only about the asking: what each row is
    // judged by does not change with the road it arrived on.
    expect(byId).toHaveLength(1);
    expect(byId[0]).toContain('wd:Q1429003');
    expect(byId[0]).toContain('wd:Q196982');
    expect(byId[0]).toContain('wd:Q3485394');
    expect(byId[0]).not.toContain('wd:Q636928');
    expect(byId[0]).not.toContain('wd:Q6373');
    expect(byId[0]).not.toContain('wd:Q43332');
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

  it('carries how many finds above the line each museum holds, for the badge', async () => {
    const out = await collect(world());

    // The count the verdict was taken on, kept on the item rather than left to
    // be worked out again from the treasures and the line: it is what says
    // whether the museum holds a masterpiece, and the badge is the masterpiece
    // (ADR-0045 decision 5). Not `treasures.length` — a museum arrives with
    // everything it holds, however famous.
    expect(item(out, 'Q6373')?.findsAboveLine).toBe(1);
    expect(item(out, 'Q636928')?.findsAboveLine).toBe(1);
    // In the catalogue on its own 35 articles, holding nothing the run knows.
    expect(item(out, 'Q1429003')?.findsAboveLine).toBe(0);
  });

  it('credits nobody with a find three museums claim, and still lists it on each card', async () => {
    // The holder cap is one answer, and it has to be the same answer down every
    // road. `findJudged` asks `selectTier1`, which sends a unique work claimed
    // by more than two venues to a curator and admits none of them; the Louvre
    // and the British Museum are here by their class and their category anyway,
    // so before the cap bound `credited` too they were admitted below the place
    // line and badged for a find the same run said admits nobody.
    //
    // And the card is untouched by it, as the art import's is: pieces of one
    // hoard split between three museums are a real thing to go and see in each
    // of the three rooms, and dropping the find from all three would tell a
    // traveller less than the source knows.
    const w = world();
    w.finds.Q48584.statements = [
      { property: 'P195', venue: 'Q6373' },
      { property: 'P195', venue: 'Q19675' },
      { property: 'P195', venue: 'Q1429003' },
    ];

    const out = await collect(w);

    for (const qid of ['Q6373', 'Q19675', 'Q1429003']) {
      expect(item(out, qid)?.findsAboveLine).toBe(0);
      expect(item(out, qid)?.admittedFor).toBeUndefined();
      expect(treasuresOf(out, qid)).toContain('Q48584');
    }
  });

  it('credits both museums with a find the two of them claim', async () => {
    // The other side of the cap: two venues is the most one visit can settle,
    // so the Rosetta Stone at the British Museum and the Louvre is a find of
    // each, and each is badged for it.
    const w = world();
    w.finds.Q48584.statements = [
      { property: 'P195', venue: 'Q6373' },
      { property: 'P195', venue: 'Q19675' },
    ];

    const out = await collect(w);

    for (const qid of ['Q6373', 'Q19675']) {
      expect(item(out, qid)?.findsAboveLine).toBe(1);
      expect(treasuresOf(out, qid)).toContain('Q48584');
    }
  });

  it('keeps an admitted museum whose find slipped into the band, and badges it for nothing', async () => {
    // The two questions the finds' line is asked, and they are not the same
    // question. At 16 articles the Charioteer is below the finds' enter line of
    // 18 and above their stay line of 15: the door forgives the slip, so Delphi
    // stays in the catalogue and still names the Charioteer as what admitted
    // it — and the badge does not, because the treasure writer will leave a
    // find at 16 unbadged, and a museum marked must-see for a work shown
    // without the mark is the disagreement ADR-0023 decision 2 forbids.
    const w = world();
    w.finds.Q1230882.sitelinks = 16;

    const out = await collect(w, { admitted: ['Q636928'] });

    expect(item(out, 'Q636928')).toMatchObject({
      sitelinks: 15,
      admittedFor: { qid: 'Q1230882', label: 'Charioteer of Delphi' },
      findsAboveLine: 0,
    });
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

    // Only the museums the pool typed archaeological, the rows the categories
    // named and the holders of a find above the line are judged, so the long
    // tail produces no refusals at all — these four and nothing else. The
    // Pio-Clementino leads: a museum that folded is reported by where it went,
    // and those lines come before the rules' own so that a folded museum is
    // never named twice. The rest follow most famous first as the run judges
    // them: Pompeii and Hadrian's Villa, which the shelf named and the rule
    // turned away as sites, and the Uffizi, an art museum with one ancient
    // statue.
    expect(out.filtered.map((f) => f.externalId))
      .toEqual(['Q1439912', 'Q43332', 'Q51252', 'Q272777']);
    // Two museums the class question named; five rows the categories asked
    // after, of which the Gold Museum's was dropped for want of an article and
    // is counted all the same, because the run fetched it; and six finds:
    // thirteen entities. Pompeii is not among them — the walk named it, but the
    // venue graph already had it and no question of this run's went out for it.
    expect(out.fetched).toBe(13);
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

  /**
   * The fold that strands a museum's finds on a survivor nobody ever writes.
   *
   * The **container** fold is the one that can do it: a door fold takes only a
   * better-known door (`doorOf` compares sitelinks), but `applyContainerFolds`
   * follows `P361` within 250 m with no fame test at all, so a famous museum can
   * fold into an obscure whole. The nature filter does not catch it either — the
   * survivor is archaeological or a department, which is what that filter asks.
   *
   * Both tests keep the fixture's real geography and its real containment: the
   * Pio-Clementino museum *is* part of the Vatican Museums, 86 m away. What is
   * arranged is the pair of sitelink counts (the device the Venus of Buret'
   * already uses) and the Vatican's own find, because a container fold is
   * between two rows that each hold one. The two differ in one thing only:
   * whether the survivor is a museum this run writes.
   */
  const containerFold = (ownFindSitelinks: number): World => {
    const w = world();
    // The collection, raised above the place line: admitted on its own fame,
    // and `judgeOne` never asks whether the row folded.
    w.museums.Q1439912.sitelinks = 30;
    // The whole it is part of, dropped below the line — and holding a find of
    // its own, without which it is no container-fold candidate at all.
    w.museums.Q182955.sitelinks = 15;
    w.finds.Q24269542.sitelinks = ownFindSitelinks;
    w.finds.Q24269542.statements = [{ property: 'P195', venue: 'Q182955' }];
    // And the collection's own find is below the finds' enter line of 18. It has
    // to be: a famous find landing on the survivor admits the survivor for it
    // (ADR-0058 decision 2), which is the catalogue working rather than the hole
    // — the stranding needs a survivor nothing carries.
    w.finds.Q465762.sitelinks = 16;
    return w;
  };

  /**
   * The shape the fold decision is asked to settle: one find claimed by two
   * museums inside one container and by others elsewhere.
   *
   * Real containment throughout — the Pio-Clementino museum and the Gregorian
   * Egyptian Museum are both `P361` the Vatican Museums (Q526381: `museum`, five
   * languages, no English article, 13 m away; verified with wbgetentities on
   * 2026-09-14) — so the container fold takes both. What is arranged is the
   * Vatican's own count, its one below-line find, and who else claims the
   * Laocoön. The second museum is added here rather than to the shared fixture
   * because only these two tests need a second department.
   */
  const twoInOneContainer = (alsoClaimedBy: string[]): World => {
    const w = world();
    // S: the container, below the place line, with one find of its own below the
    // finds' enter line — without which it is no container-fold candidate.
    w.museums.Q182955.sitelinks = 15;
    w.finds.Q24269542.sitelinks = 16;
    w.finds.Q24269542.statements = [{ property: 'P195', venue: 'Q182955' }];
    w.museums.Q526381 = {
      label: 'Gregorian Egyptian Museum', classes: [MUSEUM], sitelinks: 5,
      lat: 41.9064, lon: 12.4546, parents: ['Q182955'],
    };
    // F, above the finds' enter line, claimed by both departments and by
    // whoever else the case names.
    w.finds.Q465762.statements = [
      { property: 'P195', venue: 'Q1439912' },
      { property: 'P195', venue: 'Q526381' },
      ...alsoClaimedBy.map((venue) => ({ property: 'P195' as const, venue })),
    ];
    return w;
  };

  /**
   * The invariant the fold decision owes the catalogue, whatever the rounds do:
   * a museum reported as folded names a survivor the run actually writes. A line
   * pointing at a row the catalogue does not hold sends a curator looking for a
   * museum that is not there.
   */
  const foldLinesNameWrittenMuseums = (out: CollectedArchaeology): void => {
    const written = new Set(out.items.map((i) => i.label));
    for (const entry of out.filtered) {
      const into = /^folded into (.+?) — /.exec(entry.reason)?.[1];
      if (into !== undefined) expect(written.has(into), entry.reason).toBe(true);
    }
  };

  /**
   * The round a single re-pass misses, and the reason it exists: **the finds'
   * line is hysteretic too.**
   *
   * `judgeOne` measures a find's fame at the finds' *stay* line for a museum the
   * source already admits and at the *enter* line for one it does not, while the
   * holder cap is applied to every pool find before any line is read
   * (`placedFinds`). So a find **in the band** — 16, between the stay line of 15
   * and the enter line of 18 — carries a museum already in the catalogue and
   * leaves an unadmitted survivor uncarried. That is the split my wave-6
   * argument missed, and it is what lets one round's answer change the next's.
   *
   * Round 1: both Vatican departments fold into the Vatican, so the Laocoön has
   * two venues, is inside the cap, and credits the Vatican and the Museo
   * Nazionale Romano. The Vatican was never admitted, so its threshold is the
   * enter line and 16 does not carry it: unwritten, and both its folds drop. The
   * Museo Nazionale Romano *is* admitted, so its threshold is the stay line and
   * 16 does carry it: written, and the fold of the Baths museum into it stands.
   * Round 2: the Laocoön now has three venues, is over the cap, credits nobody,
   * and the Museo Nazionale Romano falls by name. Round 3 drops the Baths
   * museum's fold in its turn and writes it on its own fame.
   *
   * Real throughout except the two fame counts, which are arranged as the
   * fixture arranges the Venus of Buret': the Pio-Clementino and the Gregorian
   * Egyptian Museum are really `P361` the Vatican Museums, and the **Museum of
   * the Baths of Diocletian (Q3330142)** is really `P361` the **Museo Nazionale
   * Romano (Q1135392)**, 56 m away, both typed `archaeological museum`
   * (wbgetentities, 2026-09-14). The Baths museum's own `archaeological park`
   * class is left off its row, and that omission is the fixture's: carrying it,
   * the real item is not a venue for this kind at all (the site veto of
   * `SITE_CLASSES`), so no find is placed at it and it could be part of no fold.
   * What a park on the shelf does has its own test above.
   */
  const bandFindAcrossTwoContainers = (): World => {
    const w = world();
    // The container nobody admits, with a find of its own in the band.
    w.museums.Q182955.sitelinks = 15;
    w.finds.Q24269542.sitelinks = 16;
    w.finds.Q24269542.statements = [{ property: 'P195', venue: 'Q182955' }];
    w.museums.Q526381 = {
      label: 'Gregorian Egyptian Museum', classes: [MUSEUM], sitelinks: 5,
      lat: 41.9064, lon: 12.4546, parents: ['Q182955'],
    };
    // The container the source already admits, and the museum inside it.
    w.museums.Q1135392 = {
      label: 'Museo Nazionale Romano', classes: [NATIONAL_MUSEUM, ARCHAEOLOGICAL_MUSEUM, MUSEUM],
      sitelinks: 15, lat: 41.903426, lon: 12.499018, countryLabel: 'Italy',
      articleUrl: 'https://en.wikipedia.org/wiki/Museo_Nazionale_Romano',
    };
    w.museums.Q3330142 = {
      label: 'Museum of the Baths of Diocletian',
      classes: [ARCHAEOLOGICAL_MUSEUM, ART_MUSEUM, MUSEUM], sitelinks: 30,
      lat: 41.903873, lon: 12.498708, countryLabel: 'Italy', parents: ['Q1135392'],
    };
    // A find of the Museo Nazionale Romano's own, without which it is no
    // container-fold candidate and the Baths museum folds nowhere. Claimed by
    // three venues, so the holder cap keeps it from crediting anybody: it makes
    // the museum a fold target without also carrying it over the line, which is
    // the whole question this shape is asking.
    w.finds.Q774967.statements = [
      { property: 'P195', venue: 'Q1135392' },
      { property: 'P195', venue: 'Q51252' },
      { property: 'P195', venue: 'Q19675' },
    ];
    // The band find, claimed by both Vatican departments and by the Baths museum.
    w.finds.Q465762.sitelinks = 16;
    w.finds.Q465762.statements = [
      { property: 'P195', venue: 'Q1439912' },
      { property: 'P195', venue: 'Q526381' },
      { property: 'P195', venue: 'Q3330142' },
    ];
    return w;
  };

  it('gives a row to a venue only a partial fold set makes a holder', async () => {
    // `candidatesOf` is read once, before the verdict, and every fold set the run
    // then judges is a *partial* one — the nature narrowing on the first pass, a
    // strict subset on every round after. That matters because **holding is not
    // a fact about a museum**: `findHolders` asks `selectTier1`, whose cap is a
    // predicate over the length of a find's whole venue list, and a kept fold
    // *merges* two venues into one. So the same find can be over the cap raw and
    // under it once some folds are applied — and which venues hold it depends on
    // which folds those are.
    //
    // The Laocoön is claimed by three venues. Raw that is three, over the cap,
    // crediting nobody. With *every* fold applied the Pio-Clementino merges into
    // the Vatican Museums and the museum in the palace merges into the palace:
    // two venues, and those two are the holders the old candidate set measured.
    // But the palace is no museum of this kind, so the nature filter drops that
    // fold before the first verdict — and the set actually judged is the third
    // one, where the holders are the Vatican Museums and the *museum inside the
    // palace*, which neither extreme ever named. Without a row it reached the
    // verdict as a bare id and the run answered `no row to judge` about a museum
    // it would have admitted for the find.
    //
    // Real: the Pio-Clementino is `P361` the Vatican Museums (86 m), and the
    // **Museum Palazzo Massimo alle Terme (Q510071)** — `art museum,
    // archaeological museum`, 4 languages, below the pool's floor so no pool
    // names it — is `P361` the **Palazzo Massimo alle Terme (Q3890451)**, 31 m
    // away (wbgetentities, 2026-09-14; coordinates and counts real). The real
    // museum names a second container 235 m off, the Museo Nazionale Romano;
    // only the nearer is given, which is the one `nearestOf` picks anyway.
    // Declared: the palace's row carries `palace, museum` and not the
    // `archaeological museum` class Wikidata also gives it — that class is there
    // because the museum is *in* it, and what this shape needs is a container
    // that houses an archaeology museum without being one, which is what a
    // historic building is. Arranged: who claims the Laocoön.
    const w = world();
    w.museums.Q510071 = {
      label: 'Museum Palazzo Massimo alle Terme', classes: [ART_MUSEUM, ARCHAEOLOGICAL_MUSEUM],
      sitelinks: 4, lat: 41.901360, lon: 12.498358, countryLabel: 'Italy',
      parents: ['Q3890451'],
    };
    w.museums.Q3890451 = {
      label: 'Palazzo Massimo alle Terme', classes: [PALACE, MUSEUM], sitelinks: 12,
      lat: 41.901537, lon: 12.498062, countryLabel: 'Italy',
    };
    // The palace's own find, over the cap: it makes the palace a container-fold
    // target without carrying it over any line.
    w.finds.Q774967.statements = [
      { property: 'P195', venue: 'Q3890451' },
      { property: 'P195', venue: 'Q51252' },
      { property: 'P195', venue: 'Q19675' },
    ];
    w.finds.Q465762.statements = [
      { property: 'P195', venue: 'Q1439912' },
      { property: 'P195', venue: 'Q182955' },
      { property: 'P195', venue: 'Q510071' },
    ];

    const out = await collect(w);

    // **What this pins and what it does not.** It pins the outcome — every venue
    // the verdict reaches has a row, and the museum a partial set makes a holder
    // is judged and admitted. It is *not* a guard on the widening: the branch
    // stays unreached with the old candidate set too, because `works.placed` is
    // not the raw statements but `placeArtwork`'s answer, already put through the
    // collector's resolver and the `P361` ancestors — so two venues of one
    // institution are often one venue before a fold is ever computed, and the
    // three-venue reading the finding assumes does not survive placement here.
    // The widening is carried on the argument in `candidatesOf`, not on this.
    expect(out.filtered.filter((f) => f.reason.startsWith('no row to judge'))).toEqual([]);
    // And the museum inside the palace is judged and admitted for the find the
    // partial set hands it — 4 articles, carried over the place line by the
    // Laocoön alone (ADR-0058 decision 2).
    expect(item(out, 'Q510071')).toMatchObject({
      sitelinks: 4,
      admittedFor: { qid: 'Q465762', label: 'Laocoön and His Sons' },
    });
    expect(treasuresOf(out, 'Q510071')).toContain('Q465762');
    foldLinesNameWrittenMuseums(out);
  });

  it('asks the fold decision again after a round un-admits a museum a band find carried', async () => {
    const out = await collect(bandFindAcrossTwoContainers(), { admitted: ['Q1135392'] });

    // The invariant, and the thing one round gets wrong: with a single re-pass
    // the Baths museum is reported as folded into a Museo Nazionale Romano that
    // the same run has just refused, sending a curator to a museum the
    // catalogue does not hold.
    foldLinesNameWrittenMuseums(out);
    expect(out.filtered.map((f) => f.reason).filter((r) => r.startsWith('folded into')))
      .toEqual([]);
    // The fold dropped in the last round, so the museum stands on its own 30
    // articles and keeps the find it held.
    expect(item(out, 'Q3330142')).toMatchObject({ sitelinks: 30 });
    expect(treasuresOf(out, 'Q3330142')).toEqual(['Q465762']);
    // And the museum the band find had carried has fallen by name.
    expect(item(out, 'Q1135392')).toBeUndefined();
    expect(reason(out, 'Q1135392')).toBe(
      "15 sitelinks: below the world tier's line (22 to enter, 18 to stay)",
    );
  });

  it('keeps both folds where the container is carried by the find they hand it', async () => {
    // The reviewer's counterexample, built: two museums inside one container and
    // one elsewhere claim the Laocoön. Folded, the find has two venues — the
    // container and the museum elsewhere — which is inside the holder cap, so it
    // credits both and the container is admitted *for it* below the place line
    // (ADR-0058 decision 2). Being written, it keeps its folds, and the round
    // that would have un-folded them never comes.
    const out = await collect(twoInOneContainer(['Q196982']));

    expect(item(out, 'Q182955')?.admittedFor).toEqual({
      qid: 'Q465762', label: 'Laocoön and His Sons',
    });
    expect(treasuresOf(out, 'Q182955')).toEqual(['Q465762', 'Q24269542']);
    expect(item(out, 'Q196982')?.admittedFor?.qid).toBe('Q465762');
    expect(item(out, 'Q1439912')).toBeUndefined();
    expect(item(out, 'Q526381')).toBeUndefined();
    foldLinesNameWrittenMuseums(out);
  });

  it('drops both folds of one container together, and names no survivor it does not write', async () => {
    // One claimant more, and the find is over the holder cap the moment the
    // container collapses the two departments into one venue: three venues, so
    // it credits nobody, and the container — holding nothing else above the
    // line, at 15 articles — is written nowhere. Both folds of that one tree go
    // together, because a tree shares its terminal survivor.
    const out = await collect(twoInOneContainer(['Q196982', 'Q636928']));

    expect(item(out, 'Q182955')).toBeUndefined();
    // No fold line survives, so nothing points at the container.
    expect(out.filtered.map((f) => f.reason).filter((r) => r.startsWith('folded into')))
      .toEqual([]);
    foldLinesNameWrittenMuseums(out);
    // A contested find admits nobody, here as anywhere: the two departments have
    // it back and neither is carried over the line by it.
    expect(item(out, 'Q1439912')).toBeUndefined();
    expect(item(out, 'Q526381')).toBeUndefined();
  });

  it('gives a museum its finds back where the fold would strand them on a survivor nobody writes', async () => {
    // The Vatican at 15 articles holding one find at 16 is below the place line
    // and below the finds' enter line of 18: no pool named it, no category walk
    // named it, and no find carries it, so no verdict is taken on it at all.
    // Folded, the Laocoön went to a museum the run does not write — stored for
    // nobody — and the Pio-Clementino was admitted on its own 30 articles with
    // an empty case, neither of them named in any refusal.
    // Seeded with the Laocoön where the stranding would have left it, so the
    // diff has something to compare against: `diffPlacements` says nothing about
    // a work the last run placed nowhere, and an assertion against an empty
    // previous map passes whatever this run decided.
    const out = await collect(containerFold(16), {
      previousPlacements: { Q465762: ['Q182955'] },
    });

    expect(item(out, 'Q1439912')).toMatchObject({ sitelinks: 30 });
    expect(treasuresOf(out, 'Q1439912')).toEqual(['Q465762']);
    // And the survivor is written nowhere, so nothing is placed at it.
    expect(item(out, 'Q182955')).toBeUndefined();
    // What the run will write: the find moved off the survivor and back onto the
    // museum that held it.
    expect(out.diff.moved).toContainEqual({
      work: 'Q465762', from: ['Q182955'], to: ['Q1439912'],
    });
  });

  it('keeps the fold where the survivor is a museum the run does write', async () => {
    // The mirror, and it must stay: the same containment, the same natures, and
    // the Vatican carried over the place line by a find of its own at 20 — above
    // the finds' enter line (ADR-0058 decision 2). Now it is a museum the run
    // writes, so the collection folds into the name a traveller looks for and
    // the Laocoön is shown under it.
    const out = await collect(containerFold(20));

    expect(item(out, 'Q182955')).toMatchObject({
      sitelinks: 15,
      admittedFor: { qid: 'Q24269542', label: 'Pompeii Lakshmi' },
    });
    // Most famous first, and the folded collection's find is among them: this is
    // the Cappella Paolina shape, and nothing in the new step may touch it.
    expect(treasuresOf(out, 'Q182955')).toEqual(['Q24269542', 'Q465762']);
    // And the collection is not a second row beside it. Above the place line on
    // its own 30 articles, it would once have stood there holding nothing — two
    // pins for one visit, one of them empty because its case is next door. A
    // fold means the survivor is *the* name for both, so this one is reported by
    // where it went and by nothing else.
    expect(item(out, 'Q1439912')).toBeUndefined();
    expect(reason(out, 'Q1439912')).toBe(
      'folded into Vatican Museums — inside its P361 container, 86 m away',
    );
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
    const door = categoryDoor(w);
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
      categories: door.categories,
      categoryMembers: door.categoryMembers,
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
      categoryMembers: door.categoryMembers,
    });

    expect(door.calls).toHaveLength(1);
    expect([...door.calls[0]].sort()).toEqual([
      'Bardo National Museum (Tunis)', 'British Museum', 'Delphi Archaeological Museum',
      "Hadrian's Villa", 'Hermitage Museum', 'Louvre', 'Makthar (archaeological site)',
      'Pompeii', 'Uffizi', 'Vatican Museums', 'Zeugma Mosaic Museum',
    ]);
    // The walk is one question for the whole run, and the categories of the
    // museums it named are read with everyone else's: a member is a candidate,
    // and what the rule reads off it is the article's own list. Seven are named
    // and one of them — the Gold Museum, whose row carries no article — is not
    // asked about, because there is no title to ask under.
    expect(door.walks).toEqual([8]);
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
