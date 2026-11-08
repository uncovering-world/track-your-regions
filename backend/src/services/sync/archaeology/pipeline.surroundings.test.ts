/**
 * Archaeology's sites in the place kinds' frame (ADR-0179), through the whole
 * run: the world bars admit a site whatever it is part of, and the surroundings
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
import { ARCHAEOLOGICAL_MUSEUM, ARCHAEOLOGICAL_SITE, collect, world, type World } from './pipelineFixture.js';
import { heldPartReason, namedRuinNote, partOfReason, UNMAPPED_REASON } from './surroundingsSites.js';
import type { SurroundingsPool, SurroundingsPoolRow } from '../places/surroundingsPool.js';
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
const PAESTUM_MUSEUM = 'Q3329487'; // National Archaeological Museum of Paestum, typed an archaeological museum and park
// Dimini archaeological site: typed an archaeological culture as well as a settlement site and an archaeological site.
const DIMINI = 'Q10262223';
const ARCHAEOLOGICAL_CULTURE = 'Q465299';
const SETTLEMENT_SITE = 'Q1708422';
const ABELLINUM = 'Q318664'; // the Roman town at Atripalda, mapped as an area under its name without its item
const SABRATHA = 'Q15052130'; // Archaeological Site of Sabratha, the World Heritage listing
const MERIDA = 'Q15233334'; // Archaeological Ensemble of Mérida, the World Heritage listing
const MERIDA_THEATRE = 'Q64850369'; // Roman Theatre, Amphitheatre, the Amphitheatre House: part of Mérida's listing
const LOS_MILAGROS = 'Q3774528'; // Acueducto de los Milagros: part of Mérida's listing

function surroundingsWorld(): World {
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
    [PAESTUM_MUSEUM]: {
      label: 'National Archaeological Museum of Paestum', classes: [ARCHAEOLOGICAL_MUSEUM, ARCHAEOLOGICAL_SITE], sitelinks: 8,
      lat: 40.42339, lon: 15.006858,
    },
    [DIMINI]: { label: 'Dimini archaeological site', classes: [ARCHAEOLOGICAL_CULTURE, SETTLEMENT_SITE, ARCHAEOLOGICAL_SITE], sitelinks: 6, lat: 39.361677, lon: 22.893062 },
    [ABELLINUM]: { label: 'Abellinum', classes: [ARCHAEOLOGICAL_SITE], sitelinks: 5, lat: 40.92212, lon: 14.83123 },
    // Two World Heritage listings no OpenStreetMap object carries the item of (ADR-0185).
    [SABRATHA]: { label: 'Archaeological Site of Sabratha', classes: [ARCHAEOLOGICAL_SITE], sitelinks: 12, lat: 32.805, lon: 12.485, worldHeritage: true },
    [MERIDA]: { label: 'Archaeological Ensemble of Mérida', classes: [ARCHAEOLOGICAL_SITE], sitelinks: 10, lat: 38.916, lon: -6.338, worldHeritage: true },
    [MERIDA_THEATRE]: {
      label: 'Roman Theatre, Amphitheatre, the Amphitheatre House', classes: [ARCHAEOLOGICAL_SITE], sitelinks: 3,
      lat: 38.9156, lon: -6.3381, parents: [MERIDA],
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
function poolOf(rows: Array<Omit<SurroundingsPoolRow, 'lat' | 'lon'> & { lat?: number; lon?: number }>): SurroundingsPool {
  const full: SurroundingsPoolRow[] = rows.map((row) => ({ lat: 0, lon: 0, ...row }));
  return {
    rows: new Map(full.map((row) => [row.qid, row])),
    around: new Map([['all', new Map(full.map((row) => [row.qid, {
      groupSize: 30, topEditions: [row.editions], topGuideEditions: [row.guideEditions], topReaders: [row.readers],
    }]))]]),
    seconds: 0,
  };
}

/** The measurement's signals of the surroundings-tier candidates (2026-11-02). */
const POOL = poolOf([
  { qid: FORUM_OF_POMPEII, editions: 5, guideEditions: 4, readers: 5_165, classes: [ARCHAEOLOGICAL_SITE] },
  { qid: DIEPKLOOF, editions: 16, guideEditions: 1, readers: 6_256, classes: [CAVE, ARCHAEOLOGICAL_SITE, ROCK_SHELTER] },
  { qid: WAT_RATCHABURANA, editions: 10, guideEditions: 4, readers: 24_439, classes: [WAT] },
  { qid: TIPON, editions: 13, guideEditions: 2, readers: 9_398, classes: [ARCHAEOLOGICAL_SITE] },
  { qid: SABRATHA, editions: 12, guideEditions: 1, readers: 8_000, classes: [ARCHAEOLOGICAL_SITE] },
  { qid: ABELLINUM, editions: 5, guideEditions: 1, readers: 6_000, classes: [ARCHAEOLOGICAL_SITE] },
  { qid: PAESTUM_MUSEUM, editions: 8, guideEditions: 1, readers: 9_000, classes: [ARCHAEOLOGICAL_MUSEUM, ARCHAEOLOGICAL_SITE] },
  { qid: DIMINI, editions: 6, guideEditions: 1, readers: 6_000, classes: [ARCHAEOLOGICAL_CULTURE, SETTLEMENT_SITE, ARCHAEOLOGICAL_SITE] },
  { qid: MERIDA, editions: 10, guideEditions: 1, readers: 7_000, classes: [ARCHAEOLOGICAL_SITE] },
]);

const siteOf = (items: readonly { qid: string; type: string }[], qid: string) =>
  items.find((item): item is CollectedArchaeologySite => item.qid === qid && item.type === 'site');

describe('Archaeology\'s sites in the frame (ADR-0179)', () => {
  it('admits Giza and keeps Altamira by the world bars, though each is part of a whole the kind holds', async () => {
    const out = await collect(surroundingsWorld(), {
      admittedSites: [ALTAMIRA, GIZA_NECROPOLIS, ALTAMIRA_SERIAL], surroundings: async () => ({ pool: POOL, held: new Set() }),
    });
    expect(siteOf(out.items, GIZA)?.tier).toBeUndefined();
    expect(siteOf(out.items, ALTAMIRA)?.tier).toBeUndefined();
    expect(siteOf(out.items, GIZA_NECROPOLIS)).toBeDefined();
  });

  it('admits Tipón to the surroundings tier: a site the map draws, part of nothing the kind holds', async () => {
    const out = await collect(surroundingsWorld(), { admittedSites: [POMPEII], surroundings: async () => ({ pool: POOL, held: new Set() }) });
    const tipon = siteOf(out.items, TIPON);
    expect(tipon?.tier).toBe('surroundings');
    expect(tipon?.osm.tag).toBe('historic=archaeological_site');
    expect(tipon?.admissionNote).toContain('In the surroundings tier by');
    expect(out.surroundingsSkipped).toBeUndefined();
  });

  it('leaves Wat Ratchaburana out of the surroundings tier: a wat to Wikidata, which no class of the kind reaches', async () => {
    // The map tags it as a dig, and the map's entrance names it: that road is
    // the world tier's alone, and the wat is under its bars.
    const out = await collect(surroundingsWorld(), { admittedSites: [POMPEII], surroundings: async () => ({ pool: POOL, held: new Set() }) });
    expect(siteOf(out.items, WAT_RATCHABURANA)).toBeUndefined();
  });

  it('refuses the Forum of Pompeii in the surroundings tier: part of Pompeii, which the kind holds', async () => {
    const out = await collect(surroundingsWorld(), { admittedSites: [POMPEII], surroundings: async () => ({ pool: POOL, held: new Set() }) });
    expect(siteOf(out.items, FORUM_OF_POMPEII)).toBeUndefined();
    expect(out.filtered.find((row) => row.externalId === FORUM_OF_POMPEII)?.reason).toBe(partOfReason(`Pompeii (${POMPEII})`));
  });

  it('refuses Diepkloof Rock Shelter in the surroundings tier: the map shows no ruin or dig there', async () => {
    const out = await collect(surroundingsWorld(), { admittedSites: [POMPEII], surroundings: async () => ({ pool: POOL, held: new Set() }) });
    expect(siteOf(out.items, DIEPKLOOF)).toBeUndefined();
    expect(out.filtered.find((row) => row.externalId === DIEPKLOOF)?.reason).toBe(UNMAPPED_REASON);
  });

  it('admits Sabratha to the surroundings tier: the World Heritage List stands in for a map that shows no ruin (ADR-0185)', async () => {
    const out = await collect(surroundingsWorld(), { admittedSites: [POMPEII], surroundings: async () => ({ pool: POOL, held: new Set() }) });
    expect(siteOf(out.items, SABRATHA)?.tier).toBe('surroundings');
  });

  it('refuses Mérida\'s listing in the surroundings tier: its theatre is Archaeology\'s already (ADR-0185)', async () => {
    const out = await collect(surroundingsWorld(), {
      admittedSites: [POMPEII, MERIDA_THEATRE], surroundings: async () => ({ pool: POOL, held: new Set() }),
    });
    expect(siteOf(out.items, MERIDA)).toBeUndefined();
    expect(out.filtered.find((row) => row.externalId === MERIDA)?.reason)
      .toBe(heldPartReason(`Roman Theatre, Amphitheatre, the Amphitheatre House (${MERIDA_THEATRE})`));
    // With no part of it held, the listing enters as Sabratha does.
    const alone = await collect(surroundingsWorld(), { admittedSites: [POMPEII], surroundings: async () => ({ pool: POOL, held: new Set() }) });
    expect(siteOf(alone.items, MERIDA)?.tier).toBe('surroundings');
  });

  it('refuses no part in the name of a listing refused for its held part: Los Milagros enters beside the held theatre (ADR-0185)', async () => {
    const w = surroundingsWorld();
    w.sites[LOS_MILAGROS] = {
      label: 'Acueducto de los Milagros', classes: [ARCHAEOLOGICAL_SITE], sitelinks: 15, lat: 38.9244, lon: -6.3497, parents: [MERIDA],
    };
    w.osm[LOS_MILAGROS] = [{ ref: 'way/24479963', tags: { historic: 'archaeological_site', name: 'Acueducto de los Milagros' } }];
    const both = poolOf([
      { qid: MERIDA, editions: 10, guideEditions: 1, readers: 7_000, classes: [ARCHAEOLOGICAL_SITE] },
      { qid: LOS_MILAGROS, editions: 15, guideEditions: 1, readers: 9_000, classes: [ARCHAEOLOGICAL_SITE] },
    ]);
    const out = await collect(w, { admittedSites: [POMPEII, MERIDA_THEATRE], surroundings: async () => ({ pool: both, held: new Set() }) });
    expect(siteOf(out.items, MERIDA)).toBeUndefined();
    expect(siteOf(out.items, LOS_MILAGROS)?.tier).toBe('surroundings');
  });

  it('admits Mérida\'s listing and refuses its theatre as part of it, where both come through the cut (ADR-0185)', async () => {
    // The theatre is mapped and held by nobody: read against each other, the two would refuse each other and neither enter.
    const w = surroundingsWorld();
    w.osm[MERIDA_THEATRE] = [{ ref: 'way/33284004', tags: { historic: 'archaeological_site', name: 'Teatro romano de Mérida' } }];
    const both = poolOf([
      { qid: MERIDA, editions: 10, guideEditions: 1, readers: 7_000, classes: [ARCHAEOLOGICAL_SITE] },
      { qid: MERIDA_THEATRE, editions: 3, guideEditions: 1, readers: 6_000, classes: [ARCHAEOLOGICAL_SITE] },
    ]);
    const out = await collect(w, { admittedSites: [POMPEII], surroundings: async () => ({ pool: both, held: new Set() }) });
    expect(siteOf(out.items, MERIDA)?.tier).toBe('surroundings');
    expect(siteOf(out.items, MERIDA_THEATRE)).toBeUndefined();
    expect(out.filtered.find((row) => row.externalId === MERIDA_THEATRE)?.reason)
      .toBe(partOfReason(`Archaeological Ensemble of Mérida (${MERIDA})`));
  });

  it('admits Abellinum where the map shows a ruin near it under its name, and says so on its card (ADR-0188)', async () => {
    const ruin = { ref: 'way/228022534', name: "Area archeologica dell'antica Abellinum" };
    const w = surroundingsWorld();
    // No object carries the item; the map has the excavation under its name.
    const unnamed = await collect(w, { admittedSites: [POMPEII], surroundings: async () => ({ pool: POOL, held: new Set() }) });
    expect(siteOf(unnamed.items, ABELLINUM)).toBeUndefined();
    expect(unnamed.filtered.find((row) => row.externalId === ABELLINUM)?.reason).toBe(UNMAPPED_REASON);
    w.namedRuins = { [ABELLINUM]: ruin };
    const out = await collect(w, { admittedSites: [POMPEII], surroundings: async () => ({ pool: POOL, held: new Set() }) });
    const site = siteOf(out.items, ABELLINUM);
    expect(site?.tier).toBe('surroundings');
    expect(site?.admissionNote).toContain(namedRuinNote(ruin));
  });

  it('shows no archaeology museum by a ruin of its name: the Museum of Paestum stays out beside Paestum (ADR-0188)', async () => {
    const w = surroundingsWorld();
    w.namedRuins = { [PAESTUM_MUSEUM]: { ref: 'way/2', name: 'Paestum' } };
    const out = await collect(w, { admittedSites: [POMPEII], surroundings: async () => ({ pool: POOL, held: new Set() }) });
    expect(out.items.find((item) => item.qid === PAESTUM_MUSEUM)).toBeUndefined();
  });

  it('shows Dimini by a ruin of its name, though Wikidata also types it an archaeological culture (ADR-0188)', async () => {
    const w = surroundingsWorld();
    w.namedRuins = { [DIMINI]: { ref: 'way/3', name: 'Dimini' } };
    const out = await collect(w, { admittedSites: [POMPEII], surroundings: async () => ({ pool: POOL, held: new Set() }) });
    expect(siteOf(out.items, DIMINI)?.tier).toBe('surroundings');
  });

  it('keeps a held site the map showed by a named ruin where no layer is in place to read one (ADR-0175 decision 6)', async () => {
    const w = surroundingsWorld();
    w.namedRuins = null;
    const out = await collect(w, { admittedSites: [POMPEII], surroundings: async () => ({ pool: POOL, held: new Set([ABELLINUM]) }) });
    expect(siteOf(out.items, ABELLINUM)?.tier).toBe('surroundings');
    // A site it does not hold is not let in on a name nobody read.
    const fresh = await collect(w, { admittedSites: [POMPEII], surroundings: async () => ({ pool: POOL, held: new Set() }) });
    expect(siteOf(fresh.items, ABELLINUM)).toBeUndefined();
  });

  it('leaves the surroundings tier as it stands where no surroundings pool was read (ADR-0175 decision 6)', async () => {
    const out = await collect(surroundingsWorld(), { surroundings: async () => ({ pool: null, held: new Set([WAT_RATCHABURANA]) }) });
    expect(siteOf(out.items, WAT_RATCHABURANA)).toBeUndefined();
    expect(out.filtered.map((row) => row.externalId)).not.toContain(WAT_RATCHABURANA);
    expect(out.surroundingsSkipped).toContain('live service');
  });
});
