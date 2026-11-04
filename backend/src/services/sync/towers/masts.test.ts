/**
 * #2275: which towers are filed as masts, asked on real items with the
 * classes, the statements and the OpenStreetMap tags the dev subset and the
 * layer held on 2026-11-04, so the rule that passes here is the one measured
 * on the masts and on the television towers people go up.
 */

import { describe, expect, it, vi } from 'vitest';
import type { WikidataLandmark } from '../types.js';
import type { SparqlBinding } from '../wikidataUtils.js';
import { fileMasts, mastSign, MAST_TAGS, type MastFacts, type ReadStructures, type StructureTagsOf } from './masts.js';

const TELEVISION_TOWER = 'Q11166728';
const TRANSMITTER_MAST = 'Q1068623';
const RADIO_TRANSMITTER = 'Q190157';
const COMMUNICATION_TOWER = 'Q1798641';
const RADIO_COMMUNICATION_STATION = 'Q1474493';
const TOWER = 'Q12518';
const OBSERVATION_TOWER = 'Q1440300';
const SKYSCRAPER = 'Q11303';
const TOURIST_ATTRACTION = 'Q570116';
const MUSEUM = 'Q33506';
const RELIGIOUS_MUSEUM = 'Q92755865';
const CHURCH_TOWER = 'Q72926449';
const INCLINED_TOWER = 'Q797765';
const FREE_STANDING_TOWER = 'Q127038589';
const CLOCK_TOWER = 'Q853854';

const GUYED_MAST: StructureTagsOf = { man_made: 'mast', 'tower:type': 'communication', 'tower:construction': 'guyed_lattice' };
const MAST: StructureTagsOf = { man_made: 'mast', 'tower:type': 'communication' };

const facts = (classes: string[], carried: StructureTagsOf[], more: Partial<MastFacts> = {}): MastFacts => ({
  classes, carried, nearest: null, missesAreFacts: true, visit: [], ...more,
});

describe('mastSign', () => {
  it.each([
    ['KXTV/KOVR (Q365315)', facts([TELEVISION_TOWER], [GUYED_MAST])],
    ['KRDK-TV (Q354380)', facts([TELEVISION_TOWER], [GUYED_MAST])],
    ['KDLT (Q1442026)', facts([TELEVISION_TOWER], [GUYED_MAST])],
    ['KOBR-TV (Q753669), mapped twice', facts([TELEVISION_TOWER], [MAST, MAST])],
    ['the Hoyt Radio Tower (Q1632152), a plain tower to Wikidata', facts([TOWER], [MAST])],
    ['Lakihegy (Q366333), which Atlas Obscura lists', facts([COMMUNICATION_TOWER, RADIO_TRANSMITTER], [GUYED_MAST, GUYED_MAST, GUYED_MAST], { visit: ['P7772'] })],
    ['Nackasändaren (Q1549630)', facts([RADIO_COMMUNICATION_STATION, TELEVISION_TOWER], [MAST, MAST])],
  ])('files %s as a mast, from the object OpenStreetMap maps it as', (_name, known) => {
    expect(mastSign(known)).toBe('mapped');
  });

  it('files the Nador transmitter (Q2091534) as a mast, from the guyed mast 218 m from its point', () => {
    expect(mastSign(facts([TRANSMITTER_MAST, RADIO_TRANSMITTER], [], { nearest: GUYED_MAST }))).toBe('nearest');
  });

  it('reads the mast beside a point only on a layer that vouches for no object carrying the item', () => {
    expect(mastSign(facts([TRANSMITTER_MAST, RADIO_TRANSMITTER], [], { nearest: GUYED_MAST, missesAreFacts: false }))).toBeNull();
  });

  // The rooftop and street masts beside these on the layer of 2026-11-03, were no object to carry their items.
  it.each([
    ['the Leaning Tower of Pisa (Q39054), 222 m from a communication mast',
      [TOURIST_ATTRACTION, MUSEUM, CHURCH_TOWER, INCLINED_TOWER, RELIGIOUS_MUSEUM, FREE_STANDING_TOWER]],
    ['the Halifax Town Clock (Q1725585), 111 m from a communication mast', [CLOCK_TOWER]],
  ])('never files %s as a mast: only a transmitter is the mast beside it', (_name, classes) => {
    expect(mastSign(facts(classes, [], { nearest: MAST }))).toBeNull();
  });

  it.each([
    ['KFVS (Q753662), beside a plain tower GNIS brought in', facts([TELEVISION_TOWER], [], { nearest: { man_made: 'tower' } })],
    ['the KCCI Tower (Q381523), beside a communication tower', facts([TELEVISION_TOWER], [], { nearest: { man_made: 'tower', 'tower:type': 'communication' } })],
  ])('files %s as a mast: a transmitter no object carries and nothing marks as visited', (_name, known) => {
    expect(mastSign(known)).toBe('transmitter');
  });

  it.each([
    ['the Almaty Tower (Q960515)', facts([TELEVISION_TOWER], [
      { man_made: 'tower', 'tower:type': 'communication', 'tower:construction': 'freestanding' }, {}, { tourism: 'attraction' },
    ], { visit: ['P1301', 'P856', 'P1101'] })],
    ['the Avala Tower (Q1258275)', facts([TELEVISION_TOWER], [
      { tourism: 'attraction', man_made: 'tower', 'tower:type': 'observation' },
      { man_made: 'communications_tower', 'tower:type': 'communication', 'tower:construction': 'freestanding' },
    ], { visit: ['P1301', 'P8933', 'P1101'] })],
    ['the Cairo Tower (Q614684), a lattice OSM tags so', facts([TELEVISION_TOWER], [
      { tourism: 'attraction', man_made: 'tower', 'tower:type': 'observation', 'tower:construction': 'lattice' },
    ], { visit: ['P1301', 'P8933', 'P856', 'P1101'] })],
    ['the Rheinturm (Q679491)', facts([TELEVISION_TOWER], [
      { tourism: 'viewpoint' }, { man_made: 'communications_tower', 'tower:type': 'communication' },
    ], { visit: ['P8933', 'P7772', 'P856'] })],
    ['the Riga Radio and TV Tower (Q830319)', facts([TELEVISION_TOWER], [
      { man_made: 'tower', 'tower:type': 'communication', 'tower:construction': 'tower' },
    ], { visit: ['P1301', 'P8933', 'P7772', 'P856'] })],
    ['the Tallinn TV Tower (Q1365010)', facts([TELEVISION_TOWER], [
      { tourism: 'attraction', man_made: 'communications_tower', 'tower:type': 'communication' },
    ], { visit: ['P1301', 'P8933', 'P7772', 'P856'] })],
    ['the Vilnius TV Tower (Q1407353)', facts([TELEVISION_TOWER], [
      { tourism: 'viewpoint', man_made: 'communications_tower', 'tower:type': 'communication' },
    ], { visit: ['P8933', 'P856'] })],
    ['the Torre de Collserola (Q1147977)', facts([TELEVISION_TOWER], [
      { man_made: 'communications_tower', 'tower:type': 'communication', 'tower:construction': 'freestanding' },
    ], { visit: ['P1301', 'P8933', 'P856', 'P1101'] })],
    ['the Sky Tower (Q722125)', facts([TELEVISION_TOWER], [
      { tourism: 'attraction', man_made: 'tower', 'tower:type': 'communication' }, {},
    ], { visit: ['P1301', 'P8933', 'P7772', 'P856', 'P1101'] })],
    ['the Turkmenistan Tower (Q1407337), which states no visit', facts([TELEVISION_TOWER, SKYSCRAPER], [
      { tourism: 'attraction', man_made: 'tower' },
    ])],
    ['Rozhledna Holedná (Q100873041), a guyed lattice lookout', facts([OBSERVATION_TOWER], [
      { man_made: 'tower', 'tower:type': 'observation', 'tower:construction': 'guyed_lattice' },
    ], { visit: ['P8933'] })],
    ['Hýlačka (Q12021223), a guyed lattice lookout', facts([OBSERVATION_TOWER], [
      { man_made: 'tower', 'tower:type': 'observation', 'tower:construction': 'guyed_lattice' },
    ])],
  ])('never files %s as a mast', (_name, known) => {
    expect(mastSign(known)).toBeNull();
  });

  it('reads a guyed construction only on an object no one is let up', () => {
    expect(mastSign(facts([TOWER], [{ man_made: 'tower', 'tower:construction': 'guyed_tube' }]))).toBe('mapped');
    expect(mastSign(facts([TOWER], [{ man_made: 'tower', 'tower:construction': 'guyed_lattice', tourism: 'viewpoint' }]))).toBeNull();
    // A transmitter with a visit statement, so only the tags beside it decide.
    expect(mastSign(facts([TELEVISION_TOWER], [], { visit: ['P856'], nearest: { man_made: 'tower', 'tower:type': 'observation', 'tower:construction': 'guyed_lattice' } }))).toBeNull();
  });

  it('never reads a plain lattice as a mast', () => {
    expect(mastSign(facts([TOWER], [{ man_made: 'tower', 'tower:construction': 'lattice' }]))).toBeNull();
  });

  it('reads the structure beside the point only where no object carries the item', () => {
    expect(mastSign(facts([TELEVISION_TOWER], [{ man_made: 'communications_tower' }], { nearest: GUYED_MAST }))).toBeNull();
  });

  it('files no transmitter the layer cannot vouch for, nor one a class or a statement says is more', () => {
    const kfvs = facts([TELEVISION_TOWER], [], { nearest: { man_made: 'tower' } });
    expect(mastSign({ ...kfvs, missesAreFacts: false })).toBeNull();
    expect(mastSign({ ...kfvs, visit: ['P856'] })).toBeNull();
    expect(mastSign({ ...kfvs, classes: [TELEVISION_TOWER, OBSERVATION_TOWER] })).toBeNull();
    expect(mastSign({ ...kfvs, classes: [] })).toBeNull();
  });
});

const landmark = (qid: string, label: string, classes: string[], type: WikidataLandmark['type'] = 'observation-tower'): WikidataLandmark => ({
  qid, label, description: null, lat: 37.4, lon: -89.5, imageUrl: null, itemPictures: [], creators: [], year: null, sitelinks: 10,
  countryLabel: null, type, classes, artwork: false, articleUrl: null, website: null,
});

const entity = (id: string) => ({ value: `http://www.wikidata.org/entity/${id}` });

describe('fileMasts', () => {
  const KFVS = 'Q753662';
  const KXTV = 'Q365315';
  const TALLINN = 'Q1365010';
  const rows: SparqlBinding[] = [
    { e: entity(KXTV), prop: entity('P11693'), v: { value: '358814807' } },
    { e: entity(TALLINN), prop: entity('P1301'), v: { value: '2' } },
    { e: entity(TALLINN), prop: entity('P856'), v: { value: 'https://teletorn.ee/' } },
  ];
  const sparql = vi.fn(async () => rows);
  // The layer as it maps the three: KXTV's mast is the node Wikidata names, Tallinn's tower carries
  // its item, and KFVS's GNIS node carries none.
  const mapped: Record<string, { ref: string; kind: 'node' | 'way'; tags: StructureTagsOf }[]> = {
    'node/358814807': [{ ref: 'node/358814807', kind: 'node', tags: GUYED_MAST }],
    [TALLINN]: [{ ref: 'way/26918147', kind: 'way', tags: { man_made: 'communications_tower' } }],
  };
  const readLayer = vi.fn<ReadStructures>(async (places) => ({
    missesAreFacts: true,
    byItem: new Map(places.map((place) => [place.qid, {
      carried: [...place.refs, place.qid].flatMap((key) => mapped[key] ?? []).map((object) => ({ ...object, geometryType: null, wkt: null })),
      nearest: null,
    }])),
  }));

  it('retypes the masts it finds, from the statements and the layer, and leaves the visited towers be', async () => {
    const items = [landmark(KXTV, 'KXTV/KOVR tower', [TELEVISION_TOWER]), landmark(KFVS, 'KFVS TV Mast', [TELEVISION_TOWER]),
      landmark(TALLINN, 'Tallinn TV Tower', [TELEVISION_TOWER])];
    expect(await fileMasts(items, sparql, '[Towers]', readLayer)).toBe(2);
    expect(items.map((item) => [item.qid, item.type])).toEqual([[KXTV, 'mast'], [KFVS, 'mast'], [TALLINN, 'observation-tower']]);
    // The object Wikidata names is asked for, with the item's point and the tags that tell a mast.
    expect(readLayer).toHaveBeenCalledWith(expect.arrayContaining([{ qid: KXTV, lat: 37.4, lon: -89.5, refs: ['node/358814807'] }]), MAST_TAGS);
  });

  it('reads again only a tower its classes filed as an observation tower or a tower', async () => {
    // The Gros Horloge (Q3116957) stands 242 m from a communication mast; were a mapper to put its
    // item on that mast, the clock tower would still be a clock tower.
    const GROS_HORLOGE = 'Q3116957';
    const onTheMast = vi.fn<ReadStructures>(async (places) => ({
      missesAreFacts: true,
      byItem: new Map(places.map((place) => [place.qid, {
        carried: [{ ref: 'node/5825571787', kind: 'node' as const, tags: MAST, geometryType: null, wkt: null }], nearest: null,
      }])),
    }));
    const items = [landmark(GROS_HORLOGE, 'Gros Horloge', [CLOCK_TOWER], 'clock-tower'), landmark(KFVS, 'KFVS TV Mast', [TELEVISION_TOWER], 'tower')];
    expect(await fileMasts(items, sparql, '[Towers]', onTheMast)).toBe(1);
    expect(items.map((item) => [item.qid, item.type])).toEqual([[GROS_HORLOGE, 'clock-tower'], [KFVS, 'mast']]);
    expect(onTheMast.mock.calls[0][0].map((place) => place.qid)).toEqual([KFVS]);
  });

  it('files no mast by the map where no layer is in place, and refuses nothing', async () => {
    const items = [landmark(KFVS, 'KFVS TV Mast', [TELEVISION_TOWER])];
    expect(await fileMasts(items, sparql, '[Towers]', async () => null)).toBe(0);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('observation-tower');
  });
});
