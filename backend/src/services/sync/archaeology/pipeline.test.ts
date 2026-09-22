/**
 * The archaeology museums as one run against a fake door: the class trees, the
 * museum pool, the finds those museums hold, and what the two signals of
 * ADR-0058 decision 2 make of each museum together.
 *
 * And the kind's other door beside them, in the second block: the sites, which
 * come out of the same run and the same list of items (ADR-0058 decision 1).
 * The two meet on Pompeii and on Hadrian's Villa, which the museum door refuses
 * and the site door admits — one entity, one row, and no refusal beside it.
 *
 * The world and the doors are `pipelineFixture.ts`, which says which of its
 * rows are real and which are the fixture's own.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  collectArchaeology,
  type CollectedArchaeology,
  type CollectedArchaeologyMuseum,
} from './pipeline.js';
import {
  answer,
  categoryDoor,
  osmDoor,
  world,
  ARCHAEOLOGICAL_MUSEUM,
  ARCHAEOLOGICAL_SITE,
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
  return collectArchaeology({
    sparql: (query: string) => Promise.resolve(answer(w, query)),
    previousPlacements: opts.previousPlacements ?? {},
    admittedMuseums: new Set(opts.admitted ?? []),
    admittedSites: new Set<string>(),
    line: opts.line ?? LINE,
    categories: door.categories,
    categoryMembers: door.categoryMembers,
    osm: osmDoor(w).read,
    osmDigs: osmDoor(w).digs,
    resolveArticles: osmDoor(w).resolveArticles,
  });
}

/**
 * The museum row of an entity, which is what every assertion in this block
 * reads: one proposal carries the kind's two types (ADR-0058 decision 1), and a
 * site is nobody's museum however the two doors named it.
 */
const item = (out: CollectedArchaeology, qid: string): CollectedArchaeologyMuseum | undefined => {
  const found = out.items.find((i) => i.qid === qid);
  return found && found.type === 'museum' ? found : undefined;
};
const reason = (out: CollectedArchaeology, qid: string) =>
  out.filtered.find((f) => f.externalId === qid)?.reason;
const treasuresOf = (out: CollectedArchaeology, qid: string) =>
  (item(out, qid)?.treasures ?? []).map((t) => t.externalId);

describe('collectArchaeology', () => {
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
    // And the door it was sent to is in this same run, so what the museum rule
    // said about it is not what a curator is shown: the site door admits it and
    // the refusal goes with the row. The site half of this is asserted below.
    expect(reason(out, 'Q43332')).toBeUndefined();
    // And a find that names the dig as where it stands does not excuse it. The
    // venue graph holds every entity a work's `P276` points at, refused venues
    // included, so "the graph knows it" is not one of the roads a museum comes
    // in by: the Pompeii Lakshmi is placed nowhere and Pompeii is still asked
    // whether Wikidata calls it a museum.
    expect(out.items.some(
      (i) => i.type === 'museum' && i.treasures.some((t) => t.externalId === 'Q24269542'),
    )).toBe(false);
  });

  it('writes an archaeological park the shelf named as a site, not as a museum', async () => {
    // The class gate cannot turn this one away: Wikidata files `archaeological
    // park` under `archaeological museum` and so under `museum`, so Hadrian's
    // Villa passes `isMuseumOnWikidata` and reaches the nature rule carrying a
    // museum class. The park veto is the only thing between it and a museum pin
    // on an open-air site a traveller walks for an afternoon (#887) — and what
    // that veto says is where the row belongs: "a site, not a museum". The site
    // door is in this run now, so the sentence is carried out rather than
    // reported, and the villa in Tivoli arrives as the excavation it is.
    const out = await collect(world());

    expect(item(out, 'Q272777')).toBeUndefined();
    const villa = out.items.find((i) => i.qid === 'Q272777');
    expect(villa?.type).toBe('site');
    expect(reason(out, 'Q272777')).toBeUndefined();
    // And it arrives with what OSM drew around it: way/152327656, the measured
    // object, carrying two ruin signals and the outline. A row the museum door
    // refused, admitted by the map rather than by its class alone, with an
    // extent of its own — the one case Troy does not cover.
    if (!villa || villa.type !== 'site') throw new Error('the villa is a site');
    expect(villa.osm).toMatchObject({
      verdict: 'ruin',
      object: 'way/152327656',
      tag: 'historic=archaeological_site',
      extentFrom: 'way/152327656',
    });
    expect(villa.extentWkt).toMatch(/^POLYGON\(\(12\.77/);
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
    await collectArchaeology({
      // The by-id pool question asked about the members, which names itself in
      // the line the panel shows (`fetchEntitiesByIds`).
      sparql: (query: string, descriptor?: { label: string }) => {
        if (descriptor?.label.startsWith('museums the categories name')) byId.push(query);
        return Promise.resolve(answer(w, query));
      },
      previousPlacements: {},
      admittedMuseums: new Set<string>(),
      admittedSites: new Set<string>(),
      line: LINE,
      categories: door.categories,
      categoryMembers: door.categoryMembers,
      osm: osmDoor(w).read,
    osmDigs: osmDoor(w).digs,
    resolveArticles: osmDoor(w).resolveArticles,
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

  it('names no row the rules never ran on', async () => {
    const out = await collect(world());

    // Only the museums the pool typed archaeological, the rows the categories
    // named and the holders of a find above the line are judged, so the long
    // tail produces no refusals at all — these four and nothing else. The
    // Pio-Clementino leads: a museum that folded is reported by where it went,
    // and those lines come before the rules' own so that a folded museum is
    // never named twice. Then the Uffizi, an art museum with one ancient
    // statue; then the site door's own, most famous first — Athens, which is a
    // city people live in, and the Titanic, which is a wreck. Pompeii and
    // Hadrian's Villa are in neither list: the museum door refused them and the
    // site door wrote them, and a row this run puts on the map is not also a
    // question about whether it belongs there.
    // The Vorderasiatisches Museum is the second fold (#890): it folds into the
    // Pergamon, and a folded museum is reported once, by where it went.
    expect(out.filtered.map((f) => f.externalId))
      .toEqual(['Q1439912', 'Q542084', 'Q51252', 'Q1524', 'Q25173']);
    // Two museums the class question named; five rows the categories asked
    // after, of which the Gold Museum's was dropped for want of an article and
    // is counted all the same, because the run fetched it; six finds; and the
    // site pool's five, four of which no other question of this run named —
    // Hadrian's Villa is a category member and was already counted: seventeen
    // entities. Pompeii is not fetched twice for being named twice. Then the
    // Pergamon's world (#890): the Victory stele in the finds pool, the two
    // finds the venue-side read kept at the Pergamon and the two objects it
    // refused there — the attack, and the one Wikidata does not type — the two
    // altars of the second round and the attack both museums name —
    // twenty-five. The Pergamon Museum itself is not counted twice: the
    // stele's department is `P361` the museum, so the venue graph already held
    // it when the category members were asked after; the Museum of the Second
    // Round is a row of the graph and no pool's, so it is not counted at all.
    expect(out.fetched).toBe(25);
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
    // Exactly one fold stands, the Vorderasiatisches Museum's into the
    // Pergamon, whatever the Vatican does (#890): asserted by name, so a
    // second fold into the Pergamon could not hide behind the first.
    expect(out.filtered.filter((f) => f.reason.startsWith('folded into')).map((f) => f.externalId))
      .toEqual(['Q542084']);
    expect(reason(out, 'Q542084')).toContain('folded into Pergamon Museum');
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
    // Exactly one fold stands, the Vorderasiatisches Museum's into the
    // Pergamon, whatever the Vatican does (#890): asserted by name, so a
    // second fold into the Pergamon could not hide behind the first.
    expect(out.filtered.filter((f) => f.reason.startsWith('folded into')).map((f) => f.externalId))
      .toEqual(['Q542084']);
    expect(reason(out, 'Q542084')).toContain('folded into Pergamon Museum');
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
    await collectArchaeology({
      sparql: (query: string) => {
        // The classes-and-containers question, which is the one this run sends
        // about a museum (`fetchEntityFacts`).
        if (query.includes('?coll')) facts.push(query);
        return Promise.resolve(answer(w, query));
      },
      previousPlacements: {},
      admittedMuseums: new Set<string>(),
      admittedSites: new Set<string>(),
      line: LINE,
      categories: door.categories,
      categoryMembers: door.categoryMembers,
      osm: osmDoor(w).read,
    osmDigs: osmDoor(w).digs,
    resolveArticles: osmDoor(w).resolveArticles,
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
    await collectArchaeology({
      sparql: (query: string) => Promise.resolve(answer(w, query)),
      previousPlacements: {},
      admittedMuseums: new Set<string>(),
      admittedSites: new Set<string>(),
      line: LINE,
      categories: door.categories,
      categoryMembers: door.categoryMembers,
      osm: osmDoor(w).read,
    osmDigs: osmDoor(w).digs,
    resolveArticles: osmDoor(w).resolveArticles,
    });

    expect(door.calls).toHaveLength(1);
    expect([...door.calls[0]].sort()).toEqual([
      'Bardo National Museum (Tunis)', 'British Museum', 'Delphi Archaeological Museum',
      "Hadrian's Villa", 'Hermitage Museum', 'Louvre', 'Makthar (archaeological site)',
      'Pergamon Museum', 'Pompeii', 'Uffizi', 'Vatican Museums', 'Zeugma Mosaic Museum',
    ]);
    // The walk is one question for the whole run, and the categories of the
    // museums it named are read with everyone else's: a member is a candidate,
    // and what the rule reads off it is the article's own list. Eight are named
    // (the Pergamon Museum among them since #890) and one of them — the Gold
    // Museum, whose row carries no article — is not asked about, because there
    // is no title to ask under.
    expect(door.walks).toEqual([9]);
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

  it('names the find for a museum below the enter line on every run, not only its first', async () => {
    // The Zeugma Mosaic Museum at 20 articles sits in the band between the place
    // line's stay (18) and enter (22), holding the Pompeii Lakshmi at 19 — above
    // the finds' enter line of 18. It could not enter on 20: the Lakshmi is what
    // carries it, on the run that admits it and on every run after.
    const held = (w: World) => {
      w.finds.Q24269542.statements = [{ property: 'P195', venue: 'Q196982' }];
      return w;
    };
    const named = { qid: 'Q24269542', label: 'Pompeii Lakshmi' };

    // Never admitted: 20 is below the enter line with no standing to forgive it,
    // so the find is what carries it over and the card says so (ADR-0058
    // decision 2).
    const carried = await collect(held(world()));
    expect(item(carried, 'Q196982')).toMatchObject({ sitelinks: 20, admittedFor: named });

    // Already admitted: the place line forgives the slip to 20, and the museum
    // would stand without the find — but 20 could never have got it in, and the
    // find is still above its line. Read off the standing, the run named the
    // Lakshmi once and cleared it on every run after; Heraklion lost the
    // Phaistos disc that way at 21 (#896).
    const kept = await collect(held(world()), { admitted: ['Q196982'] });
    expect(item(kept, 'Q196982')).toMatchObject({
      sitelinks: 20, findsAboveLine: 1, admittedFor: named,
    });

    // And with the find itself in its own band — 16, below the finds' enter
    // line of 18 and above their stay line of 15 — the admitted museum still
    // names it: the find is read at the hysteretic finds' line, as the door
    // reads it, and only the badge asks the enter line (`findsAboveLine`).
    const slipped = held(world());
    slipped.finds.Q24269542.sitelinks = 16;
    const both = await collect(slipped, { admitted: ['Q196982'] });
    expect(item(both, 'Q196982')).toMatchObject({
      sitelinks: 20, findsAboveLine: 0, admittedFor: named,
    });
  });

  it("names nothing for a museum in the band whose find has fallen below the finds' line", async () => {
    // The mirror: the Lakshmi at 14 is below the finds' stay line of 15 and
    // under the pool's own floor, so it is no reason at all. The museum stays on
    // its own 20 articles — the place line forgiving the slip — and that is now
    // truly what keeps it, so the card names no find.
    const w = world();
    w.finds.Q24269542.statements = [{ property: 'P195', venue: 'Q196982' }];
    w.finds.Q24269542.sitelinks = 14;

    const kept = await collect(w, { admitted: ['Q196982'] });
    expect(item(kept, 'Q196982')).toMatchObject({ sitelinks: 20, findsAboveLine: 0 });
    expect(item(kept, 'Q196982')?.admittedFor).toBeUndefined();
  });

  it('says where the finds it writes have moved since the last run', async () => {
    const out = await collect(world(), { previousPlacements: { Q48584: ['Q999'] } });

    expect(out.diff.moved).toEqual([{ work: 'Q48584', from: ['Q999'], to: ['Q6373'] }]);
  });
});

describe('what an admitted museum holds, read from its own side (#890)', () => {
  it('lists the Ishtar Gate and the Pergamon Altar on the Pergamon, which no class ever named', async () => {
    const out = await collect(world());

    // Admitted for what it is — the category — and in the catalogue before this
    // read, holding one pool find through the department that folds into it.
    const pergamon = item(out, 'Q157298');
    expect(pergamon).toMatchObject({ nature: 'archaeological', natureWhy: 'category: Archaeological museums in Berlin' });
    expect(reason(out, 'Q542084')).toContain('folded into Pergamon Museum');

    // The stele from the pool; the Altar by its discovery place, read at the
    // Pergamon itself; the Ishtar Gate by its date, read at the Vorderasiatisches
    // Museum — a fold source, asked beside its survivor because the Gate's
    // collection statement names the department and not the museum.
    expect(treasuresOf(out, 'Q157298').sort()).toEqual(['Q158058', 'Q258695', 'Q26082']);
    const altar = pergamon?.treasures.find((t) => t.externalId === 'Q158058');
    expect(altar).toMatchObject({
      name: 'Pergamon Altar', treasureType: 'altar', foundAt: { qid: 'Q18986', label: 'Pergamon' },
    });
    const gate = pergamon?.treasures.find((t) => t.externalId === 'Q26082');
    // Typed by the lowest-numbered of its classes, deterministically: `arch`
    // (Q12277) before `city gate` (Q82117), whatever order the answer arrived in.
    expect(gate).toMatchObject({ name: 'Ishtar Gate', treasureType: 'arch', year: -575, foundAt: null });

    // And the badge follows: two finds above the finds' enter line of 18, where
    // the pool alone left the museum with none — a museum a traveller visits
    // for the Gate and the Altar is a must-see for them (ADR-0045 decision 5).
    expect(pergamon?.findsAboveLine).toBe(2);
    // Admitted on its own 61 articles, so it names no find as its reason.
    expect(pergamon?.admittedFor).toBeUndefined();
  });

  it('reports what a museum holds that is not a find, with its classes, and marks nothing', async () => {
    const out = await collect(world());

    // The 2015 attack is located in the Bardo: read, refused by the find rule,
    // and named with the class a person would need to see — never a row of the
    // source, so never a refusal of the Bardo, which stands admitted.
    expect(out.refusedContents).toContainEqual({
      externalId: 'Q19613356',
      name: 'Bardo National Museum attack',
      reason: 'not a find by its classes: mass murder (Q750215) — held by Bardo National Museum',
    });
    // An item Wikidata does not type at all is read the same way and refused
    // for that — with a date the finds rule would otherwise have taken — and
    // the report says so, since there is no class to name.
    expect(out.refusedContents).toContainEqual({
      externalId: 'Q900814',
      name: 'Untyped Object of the Pergamon',
      reason: 'not a find by its classes: no class at all — held by Pergamon Museum',
    });
    expect(treasuresOf(out, 'Q157298')).not.toContain('Q900814');
    // Three refusals in all: these two, and the attack two museums name (the
    // second-round case below); nothing the run writes is among them.
    expect(out.refusedContents.map((r) => r.externalId).sort())
      .toEqual(['Q19613356', 'Q900813', 'Q900814']);
    expect(out.filtered.map((f) => f.externalId)).not.toContain('Q19613356');
    expect(item(out, 'Q1429003')).toBeDefined();
    expect(treasuresOf(out, 'Q1429003')).toEqual([]);
  });

  it('reads again the museum an object it read carried over the line', async () => {
    const w = world();
    const sent: string[] = [];
    const door = categoryDoor(w);
    const out = await collectArchaeology({
      sparql: (query: string) => { sent.push(query); return Promise.resolve(answer(w, query)); },
      previousPlacements: {},
      admittedMuseums: new Set(),
      admittedSites: new Set<string>(),
      line: LINE,
      categories: door.categories,
      categoryMembers: door.categoryMembers,
      osm: osmDoor(w).read,
    osmDigs: osmDoor(w).digs,
    resolveArticles: osmDoor(w).resolveArticles,
    });

    // The Altar of Two Museums is read at the Pergamon, where it stands, and
    // names the Museum of the Second Round as its owner — which the placement
    // rule follows, ownership before location where the two disagree, so the
    // altar is the second museum's and not the Pergamon's. No pool, no
    // category and no pool find reaches that museum, and the verdict admits it
    // for the altar — below the place line, above the finds' line.
    const second = item(out, 'Q900810');
    expect(second).toMatchObject({ label: 'Museum of the Second Round', nature: 'archaeological' });
    expect(second?.admittedFor).toEqual({ qid: 'Q900811', label: 'Altar of Two Museums' });
    // And its own case is read in a second round: the altar only it holds,
    // below the finds' line, is on its card, as a pool find would have been.
    expect(treasuresOf(out, 'Q900810').sort()).toEqual(['Q900811', 'Q900812']);
    expect(treasuresOf(out, 'Q157298')).not.toContain('Q900811');
    // Two rounds of holdings questions, the second asking only the new museum.
    const holdings = sent.filter((q) => q.includes('VALUES ?venue'));
    expect(holdings).toHaveLength(2);
    expect(holdings[1]).toContain('wd:Q900810');
    expect(holdings[1]).not.toContain('wd:Q157298');
    // A refusal met in both rounds is named once, with both holders: the
    // attack both museums' statements name is fetched by id in the first
    // round only, its second holder recorded from the holdings question alone.
    expect(out.refusedContents.filter((r) => r.externalId === 'Q19613356')).toHaveLength(1);
    const twice = out.refusedContents.filter((r) => r.externalId === 'Q900813');
    expect(twice).toHaveLength(1);
    expect(twice[0].reason).toBe(
      'not a find by its classes: mass murder (Q750215) — held by Pergamon Museum, Museum of the Second Round',
    );
    const byId = sent.filter((q) => q.includes('OPTIONAL { ?w wdt:P31 ?cls }') && q.includes('wd:Q900813'));
    expect(byId).toHaveLength(1);
  });

  it('reads the holdings of every admitted survivor and its fold sources, at the pool\'s floor', async () => {
    const w = world();
    const sent: string[] = [];
    const door = categoryDoor(w);
    await collectArchaeology({
      sparql: (query: string) => { sent.push(query); return Promise.resolve(answer(w, query)); },
      previousPlacements: {},
      admittedMuseums: new Set(),
      admittedSites: new Set<string>(),
      line: LINE,
      categories: door.categories,
      categoryMembers: door.categoryMembers,
      osm: osmDoor(w).read,
    osmDigs: osmDoor(w).digs,
    resolveArticles: osmDoor(w).resolveArticles,
    });
    const holdings = sent.filter((q) => q.includes('VALUES ?venue'));
    // Two rounds: the museums the first verdict admits, then the one an
    // object of the first round carried over the line.
    expect(holdings).toHaveLength(2);
    // The survivors the verdict admits, and the museums folded into them; not
    // the Uffizi, which the rule refuses, and not a site.
    for (const asked of ['Q157298', 'Q542084', 'Q6373', 'Q182955', 'Q1439912', 'Q1429003']) {
      expect(holdings[0]).toContain(`wd:${asked}`);
    }
    expect(holdings[0]).not.toContain('wd:Q51252');
    expect(holdings[0]).not.toContain('wd:Q22647');
    expect(holdings[0]).toContain('FILTER(?sl >= 10)');
  });
});

describe('the site door, beside the museums', () => {
  /** The run both doors come out of, with OpenStreetMap as a door of its own. */
  const both = (w: World) => {
    const door = categoryDoor(w);
    const osm = osmDoor(w);
    const run = collectArchaeology({
      sparql: (query: string) => Promise.resolve(answer(w, query)),
      previousPlacements: {},
      admittedMuseums: new Set<string>(),
      admittedSites: new Set<string>(),
      line: LINE,
      categories: door.categories,
      categoryMembers: door.categoryMembers,
      osm: osm.read,
      osmDigs: osm.digs,
      resolveArticles: osm.resolveArticles,
    });
    return { run, osm };
  };

  it('admits a dig, refuses a city, and writes the extent OSM drew', async () => {
    const result = await both(world()).run;

    const troy = result.items.find((i) => i.qid === 'Q22647');
    expect(troy?.type).toBe('site');
    if (!troy || troy.type !== 'site') throw new Error('Troy must be admitted as a site');
    // Not one of Troy's four classes says "dig" — `city-state, settlement site`
    // is a settlement on both branches — so what admits it is the polygon
    // somebody drew around the excavations.
    expect(troy.osm.verdict).toBe('ruin');
    expect(troy.osm.object).toBe('way/423938794');
    expect(troy.osm.tag).toBe('historic=archaeological_site');
    expect(troy.osm.extentFrom).toBe('way/423938794');
    expect(troy.extentWkt).toMatch(/^POLYGON/);
    expect(Number.isFinite(Date.parse(troy.osm.readAt))).toBe(true);

    expect(result.items.some((i) => i.qid === 'Q1524')).toBe(false);
    const athens = result.filtered.find((f) => f.externalId === 'Q1524');
    expect(athens?.reason).toContain('a living place');

    // And the wreck, which is in the tree and is not a place to stand.
    const titanic = result.filtered.find((f) => f.externalId === 'Q25173');
    expect(titanic?.reason).toBe('Wikidata types it a shipwreck');
  });

  it('reports Pompeii once, as the site it is, and not as the museum it is not', async () => {
    const result = await both(world()).run;

    const pompeii = result.items.filter((i) => i.qid === 'Q43332');
    expect(pompeii).toHaveLength(1);
    expect(pompeii[0].type).toBe('site');
    // The museum door's own refusal is dropped: a row one door admits is not a
    // refusal of the run, and a curator reading both lists would otherwise be
    // asked about a place the same run just put on the map.
    expect(result.filtered.some((f) => f.externalId === 'Q43332')).toBe(false);
  });

  it('asks OpenStreetMap once, about the site candidates and nothing else', async () => {
    const { run, osm } = both(world());
    await run;

    expect(osm.calls).toHaveLength(1);
    // The museums are not in it: a museum's nature is Wikipedia's and
    // Wikidata's question, and asking OSM about 87 more items would be 87 more
    // rows on somebody else's mirror for an answer nothing reads.
    expect(osm.calls[0]).not.toContain('Q6373');
    expect(osm.calls[0]).toContain('Q22647');
  });

  it('counts a row both doors named once, and every entity it asked about', async () => {
    const result = await both(world()).run;

    // Pompeii is one entity, however many doors named it.
    const ids = result.items.map((i) => i.qid);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.fetched).toBeGreaterThanOrEqual(new Set(ids).size);
  });

  it('leaves the museums exactly as they were', async () => {
    const result = await both(world()).run;

    const museums = result.items.filter((i) => i.type === 'museum');
    expect(museums.map((m) => m.qid)).toContain('Q6373');
    expect(museums.map((m) => m.qid)).toContain('Q1429003');
  });

  it('yields the site door where the museum door admits the same row, and says so', async () => {
    // The guard the measurement says never fires, run on purpose. The park veto
    // sends every open-air excavation the museum tree reaches to the site door,
    // so no row of the survey is admitted by both — but "no row today" is not a
    // rule, and a row that is both a museum and a dig is one Wikidata edit
    // away. The Bardo is given `archaeological site` beside its `museum`, which
    // puts it in the site pool at 35 articles while its category keeps
    // admitting it as the museum it is. One entity is one row with one type.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const w = world();
    w.museums.Q1429003.classes = [MUSEUM, ARCHAEOLOGICAL_SITE];

    const result = await both(w).run;

    const bardo = result.items.filter((i) => i.qid === 'Q1429003');
    expect(bardo).toHaveLength(1);
    expect(bardo[0].type).toBe('museum');
    expect(result.filtered.some((f) => f.externalId === 'Q1429003')).toBe(false);
    // And it is not swallowed: a row the two doors disagree about is a fact an
    // admin reading the log should see — by name, since the point of the line
    // is that somebody thinks about the place rather than looks an id up.
    expect(log.mock.calls.map((call) => String(call[0]))
      .some((line) => line.includes(
        'Bardo National Museum (Q1429003) is admitted as a museum',
      ))).toBe(true);
    log.mockRestore();
  });

  it('names the sites it admitted and groups the refusals by their reason', async () => {
    // A dry run writes nothing, so a curator reading the panel sees these
    // nowhere else. One line per group rather than per row: a run refusing two
    // hundred villages still reports them in three.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await both(world()).run;

    const lines = log.mock.calls.map((call) => String(call[0]));
    // **One line says what the run admitted**, and it is the proposal's: the
    // site door counted its own sites too, so a run printed the number twice
    // and left a reader reconciling two lines that could not disagree.
    expect(lines.filter((line) => line.includes('Admitted'))).toHaveLength(1);
    const summary = lines.find((line) => line.includes('museums'));
    // Eight: the six the museum door admits by class, the Pergamon Museum,
    // whose Ishtar Gate and Altar are what the venue-side read is for (#890), and the
    // museum an object read at the Pergamon carried over the line.
    expect(summary).toContain('Admitted 8 museums');
    // Two of the three carry an outline now: Troy's excavations and the villa
    // in Tivoli, both real objects from the measurement.
    expect(summary).toContain('3 sites (2 with an extent)');
    // One refusal of each kind here, so the counted noun is singular: a line a
    // curator reads is a sentence, not a number with an `s` glued on. The
    // groups are the tags the rule put on each refusal, and a group nothing
    // fell into is not printed — a run says what it did.
    expect(lines.find((line) => line.includes('sites refused:')))
      .toContain('1 living place, 1 by class or by name');
    expect(lines.find((line) => line.includes('living places:'))).toContain('Athens');
    expect(lines.find((line) => line.includes('by class or by name:'))).toContain('Titanic');
    log.mockRestore();
  });
});

describe('the site pool\'s second entrance, through the whole run', () => {
  it('writes a row only OpenStreetMap named with the question its card asks (#895)', async () => {
    // Ajanta Caves (Q184427, `wbgetentities` 2026-09-15): grotto / artificial
    // cave / temple, 83 sitelinks, World Heritage 242, no class under the
    // tree — and way/115567314 tagged historic=archaeological_site.
    const w = world();
    w.sites.Q184427 = {
      label: 'Ajanta Caves', classes: ['Q1131329', 'Q88778578', 'Q44539'], sitelinks: 83,
      lat: 20.55342, lon: 75.70047, worldHeritage: true, countryLabel: 'India',
      articleUrl: 'https://en.wikipedia.org/wiki/Ajanta_Caves',
    };
    w.osmDigs = {
      byItem: { Q184427: [{ ref: 'way/115567314', tags: { historic: 'archaeological_site', name: 'Ajanta Caves' } }] },
      byArticle: {},
    };
    const { items } = await collect(w);
    const ajanta = items.find((item) => item.qid === 'Q184427');
    expect(ajanta?.type).toBe('site');
    expect(ajanta && 'admissionNote' in ajanta ? ajanta.admissionNote : undefined).toBe(
      'no class of a site on Wikidata; OpenStreetMap maps an archaeological site here '
      + '(historic=archaeological_site on way/115567314)',
    );
    // Pompeii, admitted by class, carries no such question.
    const pompeii = items.find((item) => item.qid === 'Q43332');
    expect(pompeii && 'admissionNote' in pompeii ? pompeii.admissionNote : undefined).toBeUndefined();
  });
});
