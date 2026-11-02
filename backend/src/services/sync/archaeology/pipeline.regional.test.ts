/**
 * Archaeology's sites in the place kinds' frame (ADR-0179), through the whole
 * run: the world bars admit a site whatever it is part of, and the regional
 * tier asks two things more — that the map shows the place, and that it is no
 * part of a place the kind holds.
 *
 * Every QID, class, tag and object id below is real, read on 2026-11-02 from
 * the measurement of #2286 (`data/cache/2177-admission/arch-2286-*`, the local
 * Wikidata subset) and the OpenStreetMap layer (`osm_objects`) on the
 * development database. The readers and the Wikivoyage editions are the
 * measurement's; the surroundings are drawn small, each place the best of its
 * own area, so the cut lets every one through and the conditions decide.
 */
import { describe, expect, it } from 'vitest';
import { ARCHAEOLOGICAL_SITE, collect, world, type World } from './pipelineFixture.js';
import { partOfReason, UNMAPPED_REASON } from './regionalSites.js';
import type { RegionalPool, RegionalPoolRow } from '../places/regionalPool.js';
import type { CollectedArchaeologySite } from './proposal.js';

const ANCIENT_CITY = 'Q15661340';
const NECROPOLIS = 'Q125866682'; // Ancient Egyptian necropolis
const CAVE_ART = 'Q11269813'; // cave with prehistoric art
const STONE_AGE_SITE = 'Q4443227';
const CAVE = 'Q35509';
const ROCK_SHELTER = 'Q1149405';
const WAT = 'Q427287'; // a wat: a class no tree of Archaeology holds

const POMPEII = 'Q43332';
const FORUM_OF_POMPEII = 'Q3748443';
const DIEPKLOOF = 'Q2666120';
const WAT_RATCHABURANA = 'Q2552379';
const TIPON = 'Q2003624';
const GIZA = 'Q12508';
const GIZA_NECROPOLIS = 'Q13217298';
const ALTAMIRA = 'Q133575';
const ALTAMIRA_SERIAL = 'Q899302';

function regionalWorld(): World {
  const w = world();
  // `Ancient Egyptian necropolis`, `cave with prehistoric art` and `Stone Age
  // site` are under `archaeological site`; a wat is not.
  w.trees[ARCHAEOLOGICAL_SITE] = [...w.trees[ARCHAEOLOGICAL_SITE], NECROPOLIS, CAVE_ART, STONE_AGE_SITE];
  Object.assign(w.sites, {
    [POMPEII]: { label: 'Pompeii', classes: [ARCHAEOLOGICAL_SITE, ANCIENT_CITY], sitelinks: 106, lat: 40.750556, lon: 14.489722, statesPopulation: true },
    [FORUM_OF_POMPEII]: {
      label: 'Forum of Pompeii', classes: [ARCHAEOLOGICAL_SITE], sitelinks: 5, lat: 40.74944722, lon: 14.484825,
      parents: ['Q27680332', POMPEII],
    },
    [DIEPKLOOF]: {
      label: 'Diepkloof Rock Shelter', classes: [CAVE, ARCHAEOLOGICAL_SITE, ROCK_SHELTER], sitelinks: 16,
      lat: -32.386666666667, lon: 18.452777777778, parents: ['Q65936860'],
    },
    [WAT_RATCHABURANA]: {
      label: 'Wat Ratchaburana', classes: [WAT], sitelinks: 10, lat: 14.35861111, lon: 100.56722222, parents: ['Q1025100'],
    },
    [TIPON]: { label: 'Tipón', classes: [ARCHAEOLOGICAL_SITE], sitelinks: 13, lat: -13.57083333, lon: -71.78305556 },
    [GIZA]: { label: 'Giza pyramid complex', classes: [NECROPOLIS], sitelinks: 88, lat: 29.976111, lon: 31.132778, parents: [GIZA_NECROPOLIS] },
    [GIZA_NECROPOLIS]: { label: 'Giza Necropolis', classes: [NECROPOLIS], sitelinks: 85, lat: 29.983333, lon: 31.133333 },
    [ALTAMIRA]: {
      label: 'Cave of Altamira', classes: [CAVE_ART, STONE_AGE_SITE], sitelinks: 74, lat: 43.376944444444, lon: -4.11975,
      worldHeritage: true, parents: [ALTAMIRA_SERIAL],
    },
  });
  Object.assign(w.osm, {
    [POMPEII]: [{ ref: 'node/4753980853', tags: { place: 'locality', name: 'Pompei Antica' } }],
    [FORUM_OF_POMPEII]: [{ ref: 'way/395802069', tags: { historic: 'archaeological_site', name: 'Foro di Pompei (VII.8)' } }],
    // Mapped as a rock with its World Heritage reference, and nothing that says ruin or dig.
    [DIEPKLOOF]: [{ ref: 'way/1569438876', tags: { natural: 'rock', 'ref:whc': '1723-001', name: 'Diepkloof Rock Shelter' } }],
    [WAT_RATCHABURANA]: [{ ref: 'way/79265224', tags: { historic: 'archaeological_site', tourism: 'attraction', barrier: 'wall', 'name:en': 'Wat Ratchaburana' } }],
    [TIPON]: [{ ref: 'way/37084951', tags: { historic: 'archaeological_site', tourism: 'attraction', name: 'Tipón' } }],
    [GIZA]: [{ ref: 'way/73227488', tags: { historic: 'archaeological_site', archaeological_site: 'necropolis', 'name:en': 'Giza Pyramids' } }],
    [ALTAMIRA]: [{ ref: 'node/418842011', tags: { historic: 'archaeological_site', natural: 'cave_entrance', heritage: '1', name: 'Cueva de Altamira' } }],
  });
  // The map's entrance names the wat by its dig tag (ADR-0060).
  w.osmDigs = { byItem: { [WAT_RATCHABURANA]: w.osm[WAT_RATCHABURANA] }, byArticle: {} };
  return w;
}

/** A pool row and its surroundings: the place is the best of its own area, by its editions, readers and guides. */
function poolOf(rows: Array<Omit<RegionalPoolRow, 'lat' | 'lon'> & { lat?: number; lon?: number }>): RegionalPool {
  const full: RegionalPoolRow[] = rows.map((row) => ({ lat: 0, lon: 0, ...row }));
  return {
    rows: new Map(full.map((row) => [row.qid, row])),
    around: new Map([['all', new Map(full.map((row) => [row.qid, {
      groupSize: 30, topEditions: [row.editions], topGuideEditions: [row.guideEditions], topReaders: [row.readers],
    }]))]]),
    seconds: 0,
  };
}

/** The measurement's signals of the regional candidates (2026-11-02). */
const POOL = poolOf([
  { qid: FORUM_OF_POMPEII, editions: 5, guideEditions: 4, readers: 5_165, classes: [ARCHAEOLOGICAL_SITE] },
  { qid: DIEPKLOOF, editions: 16, guideEditions: 1, readers: 6_256, classes: [CAVE, ARCHAEOLOGICAL_SITE, ROCK_SHELTER] },
  { qid: WAT_RATCHABURANA, editions: 10, guideEditions: 4, readers: 24_439, classes: [WAT] },
  { qid: TIPON, editions: 13, guideEditions: 2, readers: 9_398, classes: [ARCHAEOLOGICAL_SITE] },
]);

const siteOf = (items: readonly { qid: string; type: string }[], qid: string) =>
  items.find((item): item is CollectedArchaeologySite => item.qid === qid && item.type === 'site');

describe('Archaeology\'s sites in the frame (ADR-0179)', () => {
  it('admits Giza and keeps Altamira by the world bars, though each is part of a whole the kind holds', async () => {
    const out = await collect(regionalWorld(), {
      admittedSites: [ALTAMIRA, GIZA_NECROPOLIS, ALTAMIRA_SERIAL], regional: async () => ({ pool: POOL, held: new Set() }),
    });
    expect(siteOf(out.items, GIZA)?.tier).toBeUndefined();
    expect(siteOf(out.items, ALTAMIRA)?.tier).toBeUndefined();
    expect(siteOf(out.items, GIZA_NECROPOLIS)).toBeDefined();
  });

  it('admits Tipón to the regional tier: a site the map draws, part of nothing the kind holds', async () => {
    const out = await collect(regionalWorld(), { admittedSites: [POMPEII], regional: async () => ({ pool: POOL, held: new Set() }) });
    const tipon = siteOf(out.items, TIPON);
    expect(tipon?.tier).toBe('regional');
    expect(tipon?.osm.tag).toBe('historic=archaeological_site');
    expect(tipon?.admissionNote).toContain('In the regional tier by');
    expect(out.regionalSkipped).toBeUndefined();
  });

  it('leaves Wat Ratchaburana out of the regional tier: a wat to Wikidata, which no class of the kind reaches', async () => {
    // The map tags it as a dig, and the map's entrance names it: that road is
    // the world tier's alone, and the wat is under its bars.
    const out = await collect(regionalWorld(), { admittedSites: [POMPEII], regional: async () => ({ pool: POOL, held: new Set() }) });
    expect(siteOf(out.items, WAT_RATCHABURANA)).toBeUndefined();
  });

  it('refuses the Forum of Pompeii in the regional tier: part of Pompeii, which the kind holds', async () => {
    const out = await collect(regionalWorld(), { admittedSites: [POMPEII], regional: async () => ({ pool: POOL, held: new Set() }) });
    expect(siteOf(out.items, FORUM_OF_POMPEII)).toBeUndefined();
    expect(out.filtered.find((row) => row.externalId === FORUM_OF_POMPEII)?.reason).toBe(partOfReason(`Pompeii (${POMPEII})`));
  });

  it('refuses Diepkloof Rock Shelter in the regional tier: the map shows no ruin or dig there', async () => {
    const out = await collect(regionalWorld(), { admittedSites: [POMPEII], regional: async () => ({ pool: POOL, held: new Set() }) });
    expect(siteOf(out.items, DIEPKLOOF)).toBeUndefined();
    expect(out.filtered.find((row) => row.externalId === DIEPKLOOF)?.reason).toBe(UNMAPPED_REASON);
  });

  it('leaves the regional tier as it stands where no regional pool was read (ADR-0175 decision 6)', async () => {
    const out = await collect(regionalWorld(), { regional: async () => ({ pool: null, held: new Set([WAT_RATCHABURANA]) }) });
    expect(siteOf(out.items, WAT_RATCHABURANA)).toBeUndefined();
    expect(out.filtered.map((row) => row.externalId)).not.toContain(WAT_RATCHABURANA);
    expect(out.regionalSkipped).toContain('live service');
  });
});
