import { describe, expect, it, vi } from 'vitest';

const { subsetWorkMakers } = vi.hoisted(() => ({ subsetWorkMakers: vi.fn() }));
vi.mock('../subset/publicArt.js', () => ({ subsetWorkMakers }));

import { fetchWorkMakers, isOneArtistsGarden, ONE_ARTIST_MIN_WORKS, readGardenMakers } from './gardens.js';
import { emptyFacts, type EntityFacts } from './queries.js';
import { buildTrees } from './classes.js';
import { MONUMENTS_RULE as monuments, PUBLIC_ART_RULE as art } from './kindRules.js';
import { publicArtVerdict, type PublicArtFacts } from './publicArtTest.js';
import type { QueryRunner, SparqlFn } from '../wikidataQueries.js';
import type { SparqlBinding } from '../wikidataUtils.js';

/** A sculpture garden one artist made (#2037): read off who made the works it holds. */

const ENTITY = 'http://www.wikidata.org/entity/';
const ref = (qid: string) => ({ value: `${ENTITY}${qid}` });
const GARDEN = 'Q1759852';
const VIGELAND_INSTALLATION = 'Q7460945';
const VIGELAND = 'Q213956';
const MONOLITH = 'Q11785240';
const ANGRY_BOY = 'Q16678093';
const BRIDGE = 'Q23868716';
const ART_MUSEUM = 'Q207694';

// Wikidata files a sculpture garden under sculpture (Q860861) and under
// open-air museum, so both walked trees hold the garden's own class.
const trees = buildTrees({
  sculptural: ['Q860861', 'Q179700', GARDEN], fountain: [], commemorative: [], museum: ['Q33506', ART_MUSEUM, GARDEN], worship: [], lost: [],
});

const facts = (over: Partial<PublicArtFacts>): PublicArtFacts => ({
  qid: 'Q1', classes: [GARDEN], containers: [], collections: [], commemorates: [], depicts: [], genres: [], subjects: [],
  onEarth: true, lat: 59.9, lon: 10.7, ...over,
});

function reasonOf(v: ReturnType<typeof publicArtVerdict>): string {
  expect(v.pass).toBe(false);
  return (v as { reason: string }).reason;
}

describe('isOneArtistsGarden', () => {
  it('asks for two works naming a maker, and one maker across them all', () => {
    expect(ONE_ARTIST_MIN_WORKS).toBe(2);
    expect(isOneArtistsGarden({ classes: [GARDEN], heldMakers: [[VIGELAND], [], [VIGELAND]] })).toBe(true);
    expect(isOneArtistsGarden({ classes: [GARDEN], heldMakers: [[VIGELAND], []] })).toBe(false);
    expect(isOneArtistsGarden({ classes: [GARDEN], heldMakers: [[VIGELAND], ['Q5593']] })).toBe(false);
    expect(isOneArtistsGarden({ classes: [GARDEN] })).toBe(false);
    // A park whose works are one sculptor's is no sculpture garden to ask about.
    expect(isOneArtistsGarden({ classes: ['Q22698'], heldMakers: [[VIGELAND], [VIGELAND]] })).toBe(false);
  });
});

describe('fetchWorkMakers', () => {
  it('reads each work\'s makers once, items only', async () => {
    const rows: SparqlBinding[] = [
      { work: ref(MONOLITH), maker: ref(VIGELAND) },
      { work: ref(MONOLITH), maker: ref(VIGELAND) },
      { work: ref(ANGRY_BOY), maker: ref(VIGELAND) },
      { work: ref(ANGRY_BOY), maker: { value: 'http://www.wikidata.org/.well-known/genid/abc' } },
    ];
    let sent = '';
    const sparql: SparqlFn = (q) => { sent = q; return Promise.resolve(rows); };
    const makers = await fetchWorkMakers(sparql, [MONOLITH, ANGRY_BOY, BRIDGE, 'not a qid']);
    expect([...makers]).toEqual([[MONOLITH, [VIGELAND]], [ANGRY_BOY, [VIGELAND]]]);
    expect(sent.replace(/\s+/g, ' ')).toContain(`VALUES ?work { wd:${MONOLITH} wd:${ANGRY_BOY} wd:${BRIDGE} } ?work wdt:P170 ?maker`);
  });
});

describe('readGardenMakers', () => {
  it('writes onto a garden the makers of each work it holds, and asks nothing of another candidate', async () => {
    const asked: string[] = [];
    const sparql: SparqlFn = (q) => {
      asked.push(q);
      if (q.includes('?place ?work')) {
        return Promise.resolve([MONOLITH, ANGRY_BOY, BRIDGE].map((work) => ({ place: ref(VIGELAND_INSTALLATION), work: ref(work) })));
      }
      return Promise.resolve([{ work: ref(MONOLITH), maker: ref(VIGELAND) }, { work: ref(ANGRY_BOY), maker: ref(VIGELAND) }]);
    };
    const run = { sparql, phase: vi.fn(), step: vi.fn(async () => {}) } as unknown as QueryRunner;
    // The garden's facts were read for the kind's own admission pool, outside
    // the shared one: it is asked about all the same.
    const garden: EntityFacts = { ...emptyFacts(), classes: [GARDEN] };
    const statue: EntityFacts = { ...emptyFacts(), classes: ['Q179700'] };
    await readGardenMakers(run, new Map([[VIGELAND_INSTALLATION, garden], ['Q1', statue]]));
    expect(garden.heldMakers).toEqual([[VIGELAND], [VIGELAND], []]);
    expect(statue).not.toHaveProperty('heldMakers');
    expect(asked[0]).toContain(`wd:${VIGELAND_INSTALLATION}`);
    expect(asked[0]).not.toContain('wd:Q1 ');
  });

  it('asks nothing where no candidate is a sculpture garden', async () => {
    const sparql = vi.fn() as unknown as SparqlFn;
    const run = { sparql, phase: vi.fn(), step: vi.fn(async () => {}) } as unknown as QueryRunner;
    await readGardenMakers(run, new Map([['Q1', { ...emptyFacts(), classes: ['Q179700'] }]]));
    expect(sparql).not.toHaveBeenCalled();
    expect(subsetWorkMakers).not.toHaveBeenCalled();
  });
});

describe('the verdict on a sculpture garden', () => {
  it('offers a sculpture garden one artist made, and refuses a collection of many (#2037)', () => {
    // The Vigeland installation: a sculpture garden whose six works that name
    // a maker all name Gustav Vigeland (Q213956), and two that name none.
    const vigeland = facts({ classes: [GARDEN], heldMakers: [[VIGELAND], [VIGELAND], [], [VIGELAND], [], [VIGELAND]] });
    expect(publicArtVerdict(vigeland, trees, art)).toMatchObject({ pass: true, type: 'sculpture', artwork: true });
    // Monuments & memorials takes no garden for its maker: it is no memorial.
    expect(reasonOf(publicArtVerdict(vigeland, trees, monuments))).toBe('not a monument or memorial: sculpture garden');
    // It takes Nagasaki Peace Park (Q93490), a sculpture garden and a memorial
    // park, and there the garden's class still answers as an artwork's.
    expect(publicArtVerdict(facts({ qid: 'Q93490', classes: [GARDEN, 'Q12327290'] }), trees, monuments))
      .toMatchObject({ pass: true, artwork: true });
    // Storm King holds one work Wikidata gives a maker, Andy Goldsworthy's: one is not enough.
    expect(reasonOf(publicArtVerdict(facts({ classes: [GARDEN], heldMakers: [['Q357126'], []] }), trees, art)))
      .toBe('not public art: sculpture garden');
    // The Hakone Open-Air Museum's works name Picasso and Tumarkin.
    expect(reasonOf(publicArtVerdict(facts({ classes: [GARDEN], heldMakers: [['Q5593'], ['Q777441']] }), trees, art)))
      .toBe('not public art: sculpture garden');
    // A work naming two makers names two.
    expect(reasonOf(publicArtVerdict(facts({ classes: [GARDEN], heldMakers: [[VIGELAND], [VIGELAND, 'Q5593']] }), trees, art)))
      .toBe('not public art: sculpture garden');
    // Bomarzo: no work of it names anyone, so nothing tells.
    expect(reasonOf(publicArtVerdict(facts({ classes: [GARDEN] }), trees, art))).toBe('not public art: sculpture garden');
    // Millesgården is Carl Milles's and an art museum: the museum's veto stands.
    expect(reasonOf(publicArtVerdict(facts({ classes: [GARDEN, ART_MUSEUM], heldMakers: [['Q48548'], ['Q48548']] }), trees, art)))
      .toBe('not an artwork, and typed: a museum');
    // Park Güell is a sculpture garden and a park, and both works Wikidata
    // places in it are Gaudí's: a park refuses nothing here.
    expect(publicArtVerdict(facts({ classes: [GARDEN, 'Q22698'], heldMakers: [['Q25328'], ['Q25328']] }), trees, art))
      .toMatchObject({ pass: true, type: 'sculpture' });
    // A garden that is also a hall of fame keeps that kill.
    expect(reasonOf(publicArtVerdict(facts({ classes: [GARDEN, 'Q1046088'], heldMakers: [[VIGELAND], [VIGELAND]] }), trees, art)))
      .toBe('not public art: hall of fame');
  });

});
