/**
 * The public-art collection as one run of stages against a fake door: classes
 * first, then the pool, then the facts, then the verdict and the world bars.
 *
 * The door answers by the shape of the question, so a test can say what
 * Wikidata holds and read what the catalogue would make of it.
 */

import { describe, it, expect, vi } from 'vitest';

// The street-art entrance's reads of the database (#2035): no copy of English
// Wikipedia's categories unless a test names one, and no held street-art place.
vi.mock('../../dumps/wikipedia/structureTables.js', () => ({ latestStructure: vi.fn(async () => null) }));
vi.mock('../wikipediaStructure.js', () => ({ structureItemsInCategories: vi.fn(async () => []) }));
vi.mock('../admission.js', () => ({ admittedExternalIds: vi.fn(async () => new Set()) }));

import { classifyPublicArt, type PublicArtShare } from './pipeline.js';
import type { StreetArtReading } from './streetArtPlaces.js';
import { latestStructure } from '../../dumps/wikipedia/structureTables.js';
import { structureItemsInCategories } from '../wikipediaStructure.js';
import { belowWorldBars, guidedBarNote, type WorldRead } from '../places/worldBars.js';
import { MONUMENTS_RULE, PUBLIC_ART_RULE, type KindRule } from './kindRules.js';
import { emptyFacts } from './queries.js';
import type { QueryRunner, SparqlFn } from '../wikidataQueries.js';
import type { CacheDescriptor } from '../wikidataCache.js';

import {
  BARS, BASILICA, CATHEDRAL, collectPublicArt, doorTo, gatherPublicArt, MONUMENT, SCULPTURE, UNREAD, type CastFixture, type World,
} from './pipelineFixture.js';

/** The fixture's editions bar, and the first count a held work stays at: 0.8 of 22 is 17.6. */
const EDITIONS_BAR = BARS.editions;
const STAYS_AT = 18;
const noQuestion: SparqlFn = () => Promise.reject(new Error('the bars are handed in: no question is asked'));
const below = (qid: string, editions: number, read: WorldRead = UNREAD) => belowWorldBars({ qid, editions }, read, BARS);
/**
 * The share with candidates under the shared pool's floor added, as the
 * admission pool brings them from the subset (ADR-0175, `places/gather.test.ts`):
 * the fixture's door is the live service's, which reads none.
 */
function withAdmissionPool(
  share: PublicArtShare, rows: Array<{ qid: string; label: string; sitelinks: number; classes: string[] }>,
): PublicArtShare {
  const pool = new Map(share.pool);
  const facts = new Map(share.facts);
  for (const { qid, label, sitelinks, classes } of rows) {
    pool.set(qid, {
      qid, label, description: null, lat: 43.77, lon: 11.25, onEarth: true, imageUrl: null, itemPictures: [],
      sitelinks, countryLabel: null, articleUrl: null, website: null, year: null,
    });
    facts.set(qid, { ...emptyFacts(), classes });
  }
  return { ...share, pool, facts };
}

/** Classify a gather at the fixture's bars, with what the world reads of it. */
const classifyAt = (
  gathered: PublicArtShare, rule: KindRule, admitted: ReadonlySet<string>,
  { read = UNREAD, streetArt = null }: { read?: WorldRead; streetArt?: StreetArtReading | null } = {},
) => classifyPublicArt(gathered, rule, admitted, noQuestion, undefined, streetArt, { read, bars: BARS });

describe('collectPublicArt', () => {
  it('reads a group of casts as one place with a point at every cast, entering through them where it has no point (#880)', async () => {
    const CAST_GROUP = 'Q28890616';
    const GROUP_OF_SCULPTURES = 'Q2293362';
    const world: World = {
      // The casts' class is a sculpture; the group's own says only "group of casts".
      children: { [SCULPTURE]: [GROUP_OF_SCULPTURES] },
      entities: [
        // The Burghers of Calais: a group with a point of its own, named by the class question.
        { qid: 'Q978987', label: 'The Burghers of Calais', under: CAST_GROUP, sitelinks: 30, coord: 'Point(1.8533 50.9524)', classes: [CAST_GROUP] },
        // The Thinker: no point of its own; it enters through its one cast.
        { qid: 'Q18003128', label: 'The Thinker', under: '', sitelinks: 53, classes: [CAST_GROUP] },
      ],
      casts: {
        Q978987: [
          { qid: 'Q29273401', label: 'The Burghers of Calais', coord: 'Point(1.8535 50.9523)', at: { qid: 'Q6454', label: 'Calais' }, country: 'France', classes: [GROUP_OF_SCULPTURES] },
          { qid: 'Q47522991', label: 'The Burghers of Calais, Stanford', coord: 'Point(-122.1699 37.428)', at: { qid: 'Q41506', label: 'Stanford University' }, country: 'United States', classes: [GROUP_OF_SCULPTURES] },
          // A loan that ended is no cast.
          { qid: 'Q900001', label: 'The Burghers of Calais (loan)', coord: 'Point(2.3 48.8)', at: { qid: 'Q19675', label: 'Louvre', ended: true }, classes: [GROUP_OF_SCULPTURES] },
        ],
        Q18003128: [
          { qid: 'Q130544842', label: 'Le Penseur (Kyoto National Museum)', coord: 'Point(135.7723 34.99)', at: { qid: 'Q147286', label: 'Kyoto National Museum' }, country: 'Japan', classes: [SCULPTURE] },
        ],
      },
      // What the casts stand in, which the rule judges each cast by (#2036).
      // No museum tree is given, so nothing here holds a cast.
      containers: {
        Q6454: { label: 'Calais', classes: ['Q515'] },
        Q41506: { label: 'Stanford University', classes: ['Q3918'] },
        Q147286: { label: 'Kyoto National Museum', classes: ['Q33506'] },
      },
    };
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set());
    expect(filtered).toEqual([]);
    const burghers = items.find((i) => i.qid === 'Q978987')!;
    expect(burghers.casts).toEqual([
      { name: 'Calais', lat: 50.9523, lon: 1.8535, countryLabel: 'France' },
      { name: 'Stanford University', lat: 37.428, lon: -122.1699, countryLabel: 'United States' },
    ]);
    // The group's own point stays what the verdict read; the casts' class is what admitted it.
    expect([burghers.lat, burghers.lon]).toEqual([50.9524, 1.8533]);
    expect(burghers.classes).toEqual([CAST_GROUP, GROUP_OF_SCULPTURES]);
    const thinker = items.find((i) => i.qid === 'Q18003128')!;
    expect([thinker.lat, thinker.lon]).toEqual([34.99, 135.7723]);
    expect(thinker.countryLabel).toBe('Japan');
    expect(thinker.casts).toEqual([{ name: 'Kyoto National Museum', lat: 34.99, lon: 135.7723, countryLabel: 'Japan' }]);
  });

  it('admits a group of casts when one cast stands outdoors, and refuses it when every cast is held (#2036)', async () => {
    const CAST_GROUP = 'Q28890616';
    const MUSEUM = 'Q33506';
    const rodinCast = { qid: 'Q900200', label: 'The Thinker (Musée Rodin)', coord: 'Point(2.3158 48.8553)', at: { qid: 'Q650519', label: 'Musée Rodin' }, country: 'France', classes: [SCULPTURE] };
    const worldWith = (second: CastFixture, sitelinks = 53): World => ({
      museumTree: [MUSEUM],
      // The Thinker as Wikidata places the group: in Musée Rodin, which the
      // group's own verdict would have refused it as.
      entities: [{ qid: 'Q18003128', label: 'The Thinker', under: '', sitelinks, classes: [CAST_GROUP], locations: ['Q650519', 'Q845468'] }],
      casts: { Q18003128: [rodinCast, second] },
      containers: {
        Q650519: { label: 'Musée Rodin', classes: [MUSEUM] },
        Q1486: { label: 'Buenos Aires', classes: ['Q515'] },
        Q147286: { label: 'Kyoto National Museum', classes: [MUSEUM] },
        Q845468: { label: 'Strasbourg Museum of Modern and Contemporary Art', classes: [MUSEUM] },
      },
    });

    const outdoors = await collectPublicArt(doorTo(worldWith(
      { qid: 'Q900201', label: 'The Thinker (Buenos Aires)', coord: 'Point(-58.3926 -34.6097)', at: { qid: 'Q1486', label: 'Buenos Aires' }, country: 'Argentina', classes: [SCULPTURE] },
    )), new Set());
    expect(outdoors.filtered).toEqual([]);
    // Public art shows the cast a passer-by walks up to; the one in the museum is the museum's,
    // handed over with the places the group's own statements name, so neither kind loses it.
    expect(outdoors.items.map((i) => [i.qid, i.casts])).toEqual([['Q18003128', [
      { name: 'Buenos Aires', lat: -34.6097, lon: -58.3926, countryLabel: 'Argentina' },
    ]]]);
    expect(outdoors.handOvers).toEqual([{
      externalId: 'Q18003128', name: 'The Thinker',
      reason: 'taken as public art at its other casts; a cast inside Musée Rodin: a work of a museum, not public art',
      heldIn: ['Q650519', 'Q845468'],
    }]);

    // A group the source held that fell below the stay line is refused, and the museum
    // still takes its cast: the hand-over then carries the cast's own reason, not the
    // admitted wording.
    const fell = await collectPublicArt(doorTo(worldWith(
      { qid: 'Q900201', label: 'The Thinker (Buenos Aires)', coord: 'Point(-58.3926 -34.6097)', at: { qid: 'Q1486', label: 'Buenos Aires' }, country: 'Argentina', classes: [SCULPTURE] },
      STAYS_AT - 1,
    )), new Set(['Q18003128']));
    expect(fell.items).toEqual([]);
    expect(fell.filtered.map((f) => f.externalId)).toEqual(['Q18003128']);
    expect(fell.handOvers).toEqual([{
      externalId: 'Q18003128', name: 'The Thinker',
      reason: 'inside Musée Rodin: a work of a museum, not public art',
      heldIn: ['Q650519', 'Q845468'],
    }]);

    const held = await collectPublicArt(doorTo(worldWith(
      { qid: 'Q130544842', label: 'Le Penseur (Kyoto National Museum)', coord: 'Point(135.7723 34.99)', at: { qid: 'Q147286', label: 'Kyoto National Museum' }, country: 'Japan', classes: [SCULPTURE] },
    )), new Set());
    expect(held.items).toEqual([]);
    expect(held.filtered).toEqual([{
      externalId: 'Q18003128', name: 'The Thinker',
      reason: 'every cast is held — inside Musée Rodin: a work of a museum, not public art; '
        + 'inside Kyoto National Museum: a work of a museum, not public art',
      // The casts' holders, then the places the group's own statements name, for a museum's run to take it (ADR-0102).
      heldIn: ['Q650519', 'Q147286', 'Q845468'],
    }]);
    expect(held.handOvers).toEqual([]);
  });

  it('admits what clears the line and files what the rule refuses, with its reason', async () => {
    const world: World = {
      worshipTree: ['Q1370598', CATHEDRAL, BASILICA],
      containers: { Q12512: { label: "St. Peter's Basilica", classes: [BASILICA] } },
      entities: [
        { qid: 'Q337179', label: 'Freedom Monument', under: MONUMENT, sitelinks: 41, classes: [MONUMENT] },
        { qid: 'Q1499912', label: 'Segovia Cathedral', under: MONUMENT, sitelinks: 31, classes: [CATHEDRAL, MONUMENT] },
        { qid: 'Q235242', label: 'Pietà', under: SCULPTURE, sitelinks: 56, classes: [SCULPTURE],
          locations: ['Q12512'], creators: ['Michelangelo'] },
      ],
    };
    const monuments = await collectPublicArt(doorTo(world), new Set(), undefined, MONUMENTS_RULE);
    expect(monuments.items.map((i) => i.qid)).toEqual(['Q337179']);
    expect(monuments.items[0]).toMatchObject({ type: 'monument', classes: [MONUMENT], creators: [], artwork: false });
    expect(monuments.fetched).toBe(3);

    const { items, filtered } = await collectPublicArt(doorTo(world), new Set());
    expect(items).toEqual([]);
    expect(filtered).toEqual([
      {
        externalId: 'Q235242', name: 'Pietà', reason: "inside St. Peter's Basilica: a work of a place of worship, not public art",
        heldIn: ['Q12512'],
      },
      { externalId: 'Q337179', name: 'Freedom Monument', reason: 'no public-art class' },
      { externalId: 'Q1499912', name: 'Segovia Cathedral', reason: 'a place of worship, not public art' },
    ]);
  });

  it('classifies one gather for two sources without asking Wikidata again (ADR-0132)', async () => {
    const world: World = {
      entities: [
        { qid: 'Q1', label: 'Stays', under: MONUMENT, sitelinks: STAYS_AT + 1, classes: [MONUMENT] },
        { qid: 'Q3', label: 'Enters', under: MONUMENT, sitelinks: EDITIONS_BAR, classes: [MONUMENT] },
        { qid: 'Q4', label: 'A statue', under: SCULPTURE, sitelinks: EDITIONS_BAR, classes: [SCULPTURE] },
        { qid: 'Q5', label: 'Both', under: SCULPTURE, sitelinks: EDITIONS_BAR, classes: [SCULPTURE, MONUMENT] },
      ],
    };
    let questions = 0;
    const door = doorTo(world);
    const gathered = await gatherPublicArt({ ...door, sparql: (q, d) => { questions++; return door.sparql(q, d); } }, new Set(['Q1']));
    const asked = questions;

    // Each kind decides by its own rule, and each source holds its own stay
    // line: the one that admitted Q1 keeps it.
    const ids = async (rule: KindRule, admitted: string[]) =>
      (await classifyAt(gathered, rule, new Set(admitted))).items.map((i) => i.qid).sort();
    expect(await ids(MONUMENTS_RULE, ['Q1'])).toEqual(['Q1', 'Q3', 'Q5']);
    expect(await ids(MONUMENTS_RULE, [])).toEqual(['Q3', 'Q5']);
    expect(await ids(PUBLIC_ART_RULE, [])).toEqual(['Q4', 'Q5']);
    expect(questions).toBe(asked);
  });

  it('keeps an admitted row that slipped below the editions bar but not below 0.8 of it', async () => {
    const world: World = {
      entities: [
        { qid: 'Q1', label: 'Stays', under: MONUMENT, sitelinks: STAYS_AT + 1, classes: [MONUMENT] },
        { qid: 'Q2', label: 'Not yet', under: MONUMENT, sitelinks: EDITIONS_BAR - 1, classes: [MONUMENT] },
        { qid: 'Q3', label: 'Enters', under: MONUMENT, sitelinks: EDITIONS_BAR, classes: [MONUMENT] },
        { qid: 'Q4', label: 'Fountain of Cybele', under: MONUMENT, sitelinks: STAYS_AT - 1, classes: [MONUMENT] },
        { qid: 'Q5', label: 'Never in', under: MONUMENT, sitelinks: STAYS_AT - 1, classes: [MONUMENT] },
      ],
    };
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set(['Q1', 'Q4']), undefined, MONUMENTS_RULE);

    expect(items.map((i) => i.qid).sort()).toEqual(['Q1', 'Q3']);
    // An admitted row that fell under every stay bar is refused by name, with
    // its numbers; one that was never in is not a refusal and nothing is said.
    expect(filtered).toEqual([{
      externalId: 'Q4', name: 'Fountain of Cybele', reason: below('Q4', STAYS_AT - 1),
      // A row the source admits carries the type its classes read, for a
      // curator's put-back to be filed under (ADR-0135).
      type: 'monument',
    }]);
  });

  it('walks a work up from its room to the building that holds it', async () => {
    // The Dendera zodiac is located in Room 325, which is in the Sully Wing,
    // which is part of the Louvre Palace: three hops, and the palace is what
    // names the building in the reason — not the tomb the work is also part
    // of, which the walk visits last, and not the city above the palace, which
    // it never fetched.
    const world: World = {
      containers: {
        Q19119449: { label: 'Room 325', classes: ['Q180516'], parents: ['Q17309954'] },
        Q17309954: { label: 'Sully Wing', classes: ['Q1125776'], parents: ['Q1075988'] },
        Q1075988: { label: 'Louvre Palace', classes: ['Q16560'], parents: ['Q90'] },
        Q90: { label: 'Paris', classes: ['Q515'] },
        Q7: { label: 'Tomb of somebody', classes: ['Q381885'] },
      },
      entities: [
        { qid: 'Q3100139', label: 'Dendera zodiac', under: SCULPTURE, sitelinks: 19, classes: [SCULPTURE],
          locations: ['Q19119449'], parents: ['Q7'] },
      ],
    };
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set(['Q3100139']));
    expect(items).toEqual([]);
    expect(filtered).toEqual([
      {
        externalId: 'Q3100139', name: 'Dendera zodiac', reason: 'inside Room 325 (Louvre Palace): a work indoors, not public art',
        // The room, and every place the walk reached above it, nearest first (ADR-0102).
        heldIn: ['Q19119449', 'Q7', 'Q17309954', 'Q1075988'],
        type: 'sculpture',
      },
    ]);
  });

  it('names the building above a room, not the city above the building', async () => {
    // A room directly inside a palace: the walk fetches the palace's city at
    // the third hop, and the reason must still name the palace — the first
    // thing above the room that is not itself a room or a wing.
    const world: World = {
      containers: {
        Q1: { label: 'Room 12', classes: ['Q180516'], parents: ['Q2'] },
        Q2: { label: 'Palazzo Barberini', classes: ['Q16560'], parents: ['Q220'] },
        Q220: { label: 'Rome', classes: ['Q515'] },
      },
      entities: [
        { qid: 'Q9', label: 'A bust', under: SCULPTURE, sitelinks: 30, classes: [SCULPTURE], locations: ['Q1'] },
      ],
    };
    const { filtered } = await collectPublicArt(doorTo(world), new Set());
    expect(filtered).toEqual([
      {
        externalId: 'Q9', name: 'A bust', reason: 'inside Room 12 (Palazzo Barberini): a work indoors, not public art',
        heldIn: ['Q1', 'Q2', 'Q220'],
      },
    ]);
  });

  it('hands the rule how each container was reached, so a museum a monument is part of owns it', async () => {
    // The Pakistan Monument: located in Shakarparian, a park; part of the
    // Pakistan Monument Museum, which stands in the monument's base and says
    // so — part of the monument, located in the park. The walk reaches the
    // park again and the monument itself above the museum; the rule reads
    // the museum as the monument's owner and what stands above it as the
    // museum's, and the park as where the monument stands (#803). A
    // sculpture that is only part of a museum has nowhere else to stand, and
    // is the museum's.
    const world: World = {
      museumTree: ['Q33506'],
      containers: {
        Q7462557: { label: 'Shakarparian', classes: ['Q22698'] },
        Q86452047: { label: 'Pakistan Monument Museum', classes: ['Q33506'], parents: ['Q7462557', 'Q3695640'] },
        Q3695640: { label: 'Pakistan Monument', classes: [MONUMENT] },
      },
      entities: [
        { qid: 'Q3695640', label: 'Pakistan Monument', under: MONUMENT, sitelinks: 25, classes: [MONUMENT],
          locations: ['Q7462557'], parents: ['Q86452047'] },
        { qid: 'Q8', label: 'A bust', under: SCULPTURE, sitelinks: 30, classes: [SCULPTURE], parents: ['Q86452047'] },
      ],
    };
    const monuments = await collectPublicArt(doorTo(world), new Set(), undefined, MONUMENTS_RULE);
    expect(monuments.items.map((i) => i.qid)).toEqual(['Q3695640']);
    const { filtered } = await collectPublicArt(doorTo(world), new Set());
    expect(filtered.filter((f) => f.externalId === 'Q8')).toEqual([{
      externalId: 'Q8', name: 'A bust',
      reason: 'part of Pakistan Monument Museum: a work of a museum, not public art',
      heldIn: ['Q86452047'],
    }]);
  });

  it('records a walk that arrives at a museum the work is part of, so the courtyard places it there', async () => {
    // A work part of a museum and located in its courtyard, which is part of
    // the museum. The museum is named by the work's own statement and reached
    // again from the courtyard; the second route is what makes it a place.
    const world: World = {
      museumTree: ['Q33506'],
      containers: {
        Q4: { label: 'A courtyard', classes: ['Q1178342'], parents: ['Q2'] },
        Q2: { label: 'A museum', classes: ['Q33506'] },
      },
      entities: [
        { qid: 'Q9', label: 'A bust', under: SCULPTURE, sitelinks: 30, classes: [SCULPTURE],
          locations: ['Q4'], parents: ['Q2'] },
      ],
    };
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set());
    expect(items).toEqual([]);
    expect(filtered).toEqual([
      { externalId: 'Q9', name: 'A bust', reason: 'inside A museum: a work of a museum, not public art', heldIn: ['Q2'] },
    ]);
  });

  it('records every route to a container, so the order of two part-of statements decides nothing', async () => {
    // A work part of a site museum and of a courtyard, both part of one
    // museum complex. Walked museum-first, the complex is reached through the
    // institution first and listed once; the courtyard's route must still be
    // recorded, or the complex would go with the museum and the veto with it.
    const complex = (parents: string[]): World => ({
      museumTree: ['Q33506'],
      containers: {
        Q2: { label: 'A site museum', classes: ['Q33506'], parents: ['Q3'] },
        Q4: { label: 'A courtyard', classes: ['Q1178342'], parents: ['Q3'] },
        Q3: { label: 'A museum complex', classes: ['Q33506'] },
      },
      entities: [
        { qid: 'Q9', label: 'A bust', under: SCULPTURE, sitelinks: 30, classes: [SCULPTURE], parents },
      ],
    });
    for (const parents of [['Q2', 'Q4'], ['Q4', 'Q2']]) {
      const { items, filtered } = await collectPublicArt(doorTo(complex(parents)), new Set());
      expect(items, parents.join(',')).toEqual([]);
      expect(filtered, parents.join(',')).toEqual([
        {
          externalId: 'Q9', name: 'A bust', reason: 'inside A museum complex: a work of a museum, not public art',
          heldIn: ['Q3'],
        },
      ]);
    }
  });

  it('reads whose collection a work is in only when nothing says where it stands', async () => {
    // The Shigir Idol: no location, no part-of; in the collection of the
    // Sverdlovsk Regional Natural History Museum — the first live run admitted
    // it as a monument on the museum (#804). The Sibelius Monument: located in
    // Sibelius Park, in the collection of HAM Helsinki Art Museum, which owns
    // the city's outdoor sculpture — the park is where it stands, and the
    // museum is not asked about.
    const world: World = {
      museumTree: ['Q33506', 'Q1970365', 'Q207694'],
      containers: {
        Q4410161: { label: 'Sverdlovsk Regional Natural History Museum', classes: ['Q1970365'] },
        Q3481120: { label: 'Sibelius Park', classes: ['Q22698'] },
        Q5710459: { label: 'HAM Helsinki Art Museum', classes: ['Q207694'] },
      },
      entities: [
        { qid: 'Q4523656', label: 'Shigir Idol', under: SCULPTURE, sitelinks: 33, classes: [SCULPTURE],
          collections: ['Q4410161'] },
        { qid: 'Q2584017', label: 'Sibelius Monument', under: SCULPTURE, sitelinks: 22, classes: [SCULPTURE],
          locations: ['Q3481120'], collections: ['Q5710459'] },
      ],
    };
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set());
    expect(items.map((i) => i.qid)).toEqual(['Q2584017']);
    expect(filtered).toEqual([{
      externalId: 'Q4523656', name: 'Shigir Idol',
      reason: 'in the collection of Sverdlovsk Regional Natural History Museum: a work of a museum, not public art',
      heldIn: ['Q4410161'],
    }]);
  });

  it('refuses an admitted row whose coordinate Wikidata removed, by name', async () => {
    const world: World = {
      entities: [
        { qid: 'Q8', label: 'A lost pin', under: 'nobody', sitelinks: 40, classes: [MONUMENT], coord: '' },
      ],
    };
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set(['Q8']), undefined, MONUMENTS_RULE);
    expect(items).toEqual([]);
    expect(filtered).toEqual([{ externalId: 'Q8', name: 'A lost pin', reason: 'no coordinates of its own (P625)', type: 'monument' }]);
  });

  it('fetches an admitted row the pool no longer names, so its refusal is named too', async () => {
    // An admitted row at 14 sitelinks is below the pool floor and no class
    // question returns it; asked for by id, it is refused with its number
    // rather than swept with the generic reason.
    const world: World = {
      entities: [
        { qid: 'Q2736564', label: 'Fountain of Cybele', under: 'nobody', sitelinks: 14, classes: [MONUMENT] },
      ],
    };
    const { items, filtered } = await collectPublicArt(doorTo(world), new Set(['Q2736564']), undefined, MONUMENTS_RULE);
    expect(items).toEqual([]);
    expect(filtered).toEqual([{ externalId: 'Q2736564', name: 'Fountain of Cybele', reason: below('Q2736564', 14), type: 'monument' }]);
  });

  it('makes one entity of a row two questions both offer', async () => {
    const world: World = {
      children: { [SCULPTURE]: ['Q1779653'] },
      entities: [
        { qid: 'Q79961', label: 'Christ the Redeemer', under: SCULPTURE, sitelinks: 94, classes: [SCULPTURE, 'Q1779653'] },
        { qid: 'Q79961', label: 'Christ the Redeemer', under: 'Q1779653', sitelinks: 94, classes: [SCULPTURE, 'Q1779653'] },
      ],
    };
    const { items, fetched } = await collectPublicArt(doorTo(world), new Set());

    expect(fetched).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ qid: 'Q79961', type: 'sculpture' });
  });

  it('types a row from the sculptural closure and carries its makers', async () => {
    const world: World = {
      children: { [SCULPTURE]: ['Q1779653'] },
      entities: [
        { qid: 'Q1601986', label: 'The Motherland Calls', under: 'Q1779653', sitelinks: 54,
          classes: ['Q1779653', MONUMENT, 'Q179700'], creators: ['Yevgeny Vuchetich', 'Nikolai Nikitin'] },
      ],
    };
    const { items } = await collectPublicArt(doorTo(world), new Set());
    expect(items[0]).toMatchObject({
      type: 'sculpture', creators: ['Yevgeny Vuchetich', 'Nikolai Nikitin'],
      classes: ['Q1779653', MONUMENT, 'Q179700'],
      // The rule's own answer to "did an artwork class answer", carried for the check.
      artwork: true,
    });
  });

  it('steps the runner before every question, the class-tree hops included', async () => {
    // The step is where the pacing is spent and a cancel is heard; a closure
    // hop is one query like any other and must not go out back to back.
    const world: World = {
      children: { [SCULPTURE]: ['Q1779653'], Q1779653: ['Q29168169'] },
      entities: [{ qid: 'Q2', label: 'x', under: MONUMENT, sitelinks: 30, classes: [MONUMENT] }],
    };
    let questions = 0;
    let steps = 0;
    const door = doorTo(world);
    const runner: QueryRunner = {
      sparql: (q, d) => { questions++; return door.sparql(q, d); },
      phase: () => {},
      step: () => { steps++; return Promise.resolve(); },
    };
    await collectPublicArt(runner, new Set());
    expect(steps).toBeGreaterThanOrEqual(questions);
  });

  it('files each stage under its own cache kind', async () => {
    const asked: CacheDescriptor['kind'][] = [];
    const world: World = {
      containers: { Q1: { label: 'Somewhere', classes: ['Q174782'] } },
      entities: [{ qid: 'Q2', label: 'x', under: MONUMENT, sitelinks: 30, classes: [MONUMENT], locations: ['Q1'] }],
    };
    await collectPublicArt(doorTo(world, asked), new Set());
    expect(new Set(asked)).toEqual(new Set(['classes', 'pool', 'edges', 'entities']));
    // Every question is filed: a query with no descriptor is one the cache never keeps.
    expect(asked.length).toBeGreaterThan(0);
  });
});

describe('the world bars (ADR-0175)', () => {
  const KELPIES = 'Q16988858';
  const MAMAN = 'Q180887';
  const PORCELLINO = 'Q1713758';
  const GLOCKENSPIEL = 'Q7295591';
  const CLOCK = 'Q20826189';
  const world: World = {
    worshipTree: [BASILICA],
    containers: { Q12512: { label: "St. Peter's Basilica", classes: [BASILICA] } },
    entities: [
      { qid: KELPIES, label: 'The Kelpies', under: SCULPTURE, sitelinks: 17, classes: [SCULPTURE] },
      { qid: MAMAN, label: 'Maman', under: SCULPTURE, sitelinks: 20, classes: [SCULPTURE] },
      { qid: 'Q3', label: 'A statue nobody reads', under: SCULPTURE, sitelinks: 17, classes: [SCULPTURE] },
      { qid: 'Q7', label: 'A statue in the basilica', under: SCULPTURE, sitelinks: 17, classes: [SCULPTURE], locations: ['Q12512'] },
    ],
  };
  // Florence's Porcellino and Munich's Glockenspiel: read in few languages, listed by Atlas Obscura.
  const UNDER_THE_FLOOR = [
    { qid: PORCELLINO, label: 'Porcellino', sitelinks: 9, classes: [SCULPTURE] },
    { qid: GLOCKENSPIEL, label: 'Rathaus-Glockenspiel', sitelinks: 7, classes: [CLOCK] },
  ];
  const read: WorldRead = {
    readers: new Map([[KELPIES, 193_801], [MAMAN, 215_384], [PORCELLINO, 71_120], [GLOCKENSPIEL, 65_572], ['Q3', 400], ['Q7', 300_000]]),
    guided: new Set(),
    atlas: new Set([PORCELLINO, GLOCKENSPIEL]),
  };

  it('admits a work under the editions bar on its readers, and one a listing marks on fewer, with the curator\'s question', async () => {
    const gathered = withAdmissionPool(await gatherPublicArt(doorTo(world), new Set()), UNDER_THE_FLOOR);
    const { items, filtered } = await classifyAt(gathered, PUBLIC_ART_RULE, new Set(), { read });
    expect(items.map((i) => [i.qid, i.readershipNote])).toEqual([
      [MAMAN, undefined],
      [KELPIES, undefined],
      [PORCELLINO, guidedBarNote({ qid: PORCELLINO, editions: 9 }, read, BARS)],
      [GLOCKENSPIEL, guidedBarNote({ qid: GLOCKENSPIEL, editions: 7 }, read, BARS)],
    ]);
    // The rule still refuses a work its readers would carry, and says so: the bars make the refusal news.
    // A work under every bar is never in, and nothing is said of it.
    expect(filtered).toEqual([{
      externalId: 'Q7', name: 'A statue in the basilica',
      reason: "inside St. Peter's Basilica: a work of a place of worship, not public art", heldIn: ['Q12512'],
    }]);
  });

  it('keeps a held work at 0.8 of a bar and refuses one under them all by name', async () => {
    const held = new Set([MAMAN, 'Q3']);
    const fallen: WorldRead = { ...read, readers: new Map([[MAMAN, 80_000], ['Q3', 400]]) };
    const { items, filtered } = await classifyAt(await gatherPublicArt(doorTo(world), held), PUBLIC_ART_RULE, held, { read: fallen });
    // 80,000 readers is over 0.8 of 93,029.
    expect(items.map((i) => i.qid)).toContain(MAMAN);
    expect(filtered).toContainEqual({ externalId: 'Q3', name: 'A statue nobody reads', reason: below('Q3', 17, fallen), type: 'sculpture' });
  });
});

describe('the street-art places (#2035)', () => {
  const WALL = 'Q42948';
  const ROAD = 'Q34442';
  const STREET_ART = 'Q17516';
  const LENNON_WALL = 'Q1630131';
  const HOSIER_LANE = 'Q5908090';
  const world: World = {
    worshipTree: [CATHEDRAL],
    entities: [
      // Filed under a graffiti category, typed a wall: no class of the kind names it.
      { qid: LENNON_WALL, label: 'Lennon Wall', under: '', sitelinks: 25, coord: 'Point(14.4067 50.0864)', classes: [WALL] },
      // Filed under the genre street art, typed a road.
      { qid: HOSIER_LANE, label: 'Hosier Lane', under: '', sitelinks: 4, coord: 'Point(144.9691 -37.8166)', classes: [ROAD], genres: [STREET_ART] },
      // A cathedral a category files for its graffiti.
      { qid: 'Q9', label: 'A painted cathedral', under: '', sitelinks: 30, classes: [CATHEDRAL] },
      // A sculpture a category files too: the kind's own.
      { qid: 'Q8', label: 'A sculpture with a tag on it', under: SCULPTURE, sitelinks: EDITIONS_BAR, classes: [SCULPTURE] },
      // A monument the kind's classes name, filed under a category, with no mark.
      { qid: 'Q7', label: 'A sprayed monument', under: MONUMENT, sitelinks: 5, classes: [MONUMENT] },
      // Named by the category alone, with one mark.
      { qid: 'Q6', label: 'A local underpass', under: '', sitelinks: 2, classes: [WALL] },
    ],
  };
  const reading = (over: Partial<StreetArtReading> = {}): StreetArtReading => ({
    marks: new Map([
      [LENNON_WALL, { atlasObscura: true, ended: false }],
      [HOSIER_LANE, { atlasObscura: true, ended: false }],
      ['Q9', { atlasObscura: true, ended: false }],
      ['Q6', { atlasObscura: true, ended: false }],
    ]),
    guided: new Set([LENNON_WALL, 'Q9']),
    readers: new Map([[LENNON_WALL, 120_000], [HOSIER_LANE, 40_000], ['Q9', 50_000], ['Q6', 900]]),
    roots: new Map(),
    ...over,
  });
  const withCopy = () => {
    vi.mocked(latestStructure).mockResolvedValueOnce({ dumpDate: '2026-10-01', swappedAt: new Date(), needs: {} as never });
    vi.mocked(structureItemsInCategories).mockResolvedValueOnce([LENNON_WALL, 'Q9', 'Q8', 'Q7', 'Q6']);
  };

  it('brings in what a category or the genre files, and tells apart what only the entrance named', async () => {
    withCopy();
    const gathered = await gatherPublicArt(doorTo(world), new Set());
    expect([...gathered.entered].sort()).toEqual([HOSIER_LANE, LENNON_WALL, 'Q6', 'Q7', 'Q8', 'Q9'].sort());
    expect([...gathered.enteredOnly].sort()).toEqual([HOSIER_LANE, LENNON_WALL, 'Q6', 'Q9'].sort());
  });

  it('admits a street-art place by its marks, refuses another kind\'s place by name, and leaves the tail unsaid', async () => {
    withCopy();
    const gathered = await gatherPublicArt(doorTo(world), new Set());
    const { items, filtered } = await classifyAt(gathered, PUBLIC_ART_RULE, new Set(), { streetArt: reading() });

    expect(items.map((i) => [i.qid, i.type, i.artwork])).toEqual([
      [LENNON_WALL, 'street-art', true],
      ['Q8', 'sculpture', true],
      [HOSIER_LANE, 'street-art', true],
    ]);
    expect(filtered).toEqual([
      { externalId: 'Q9', name: 'A painted cathedral', reason: 'a place of worship: not a street-art place' },
      // Named by a class of the kind too: it keeps the kind's reason.
      { externalId: 'Q7', name: 'A sprayed monument', reason: 'no public-art class' },
    ]);
  });

  it('keeps a held street-art place on one mark, and refuses it by the line below that', async () => {
    withCopy();
    const held = new Set([LENNON_WALL]);
    const gathered = await gatherPublicArt(doorTo(world), held);
    const kept = await classifyAt(gathered, PUBLIC_ART_RULE, held, { streetArt: reading({ guided: new Set() }) });
    expect(kept.items.map((i) => i.qid)).toContain(LENNON_WALL);

    const fell = await classifyAt(gathered, PUBLIC_ART_RULE, held, { streetArt: reading({
      marks: new Map(), guided: new Set(), readers: new Map([[LENNON_WALL, 3_000]]),
    }) });
    expect(fell.items.map((i) => i.qid)).not.toContain(LENNON_WALL);
    expect(fell.filtered).toContainEqual(expect.objectContaining({
      externalId: LENNON_WALL, type: 'street-art', reason: expect.stringContaining('below the street-art line'),
    }));
  });

  it('is not Monuments & memorials\' to decide: what only the entrance named is skipped there', async () => {
    withCopy();
    const gathered = await gatherPublicArt(doorTo(world), new Set());
    const { items, filtered } = await classifyAt(gathered, MONUMENTS_RULE, new Set());
    const ids = [...items, ...filtered].map((row) => 'qid' in row ? row.qid : row.externalId);
    expect(ids).not.toContain(LENNON_WALL);
    expect(ids).not.toContain(HOSIER_LANE);
    expect(ids).not.toContain('Q9');
  });

  it('reads the genre alone when no copy of the categories is built', async () => {
    const gathered = await gatherPublicArt(doorTo(world), new Set());
    expect([...gathered.entered]).toEqual([HOSIER_LANE]);
  });
});

describe('Monuments & memorials at the world bars (ADR-0175)', () => {
  const MEMORIAL = 'Q5003624';
  const world: World = {
    entities: [
      // The Voortrekker Monument: 20 editions, used by a Wikivoyage guide, read 30,000 times a year.
      { qid: 'Q963472', label: 'Voortrekker Monument', under: MEMORIAL, sitelinks: 20, classes: [MEMORIAL] },
      // A memorial of as many editions no guide uses: never in, and nothing is said.
      { qid: 'Q2', label: 'Unguided', under: MEMORIAL, sitelinks: 20, classes: [MEMORIAL] },
      // Two held rows under 0.8 of the editions bar: one a guide uses and the year reads, one neither.
      { qid: 'Q4', label: 'Fell', under: MEMORIAL, sitelinks: STAYS_AT - 1, classes: [MEMORIAL] },
      { qid: 'Q5', label: 'Kept', under: MEMORIAL, sitelinks: STAYS_AT - 1, classes: [MEMORIAL] },
    ],
  };
  const held = new Set(['Q4', 'Q5']);
  const read: WorldRead = {
    readers: new Map([['Q963472', 30_000], ['Q2', 30_000], ['Q4', 1_000], ['Q5', 18_000]]),
    guided: new Set(['Q963472', 'Q5']),
    atlas: new Set(),
  };

  it('admits a memorial a guide uses on its readers, for a curator, and keeps or drops a held row by the third bar', async () => {
    const gathered = await gatherPublicArt(doorTo(world), held);
    const { items, filtered } = await classifyAt(gathered, MONUMENTS_RULE, held, { read });
    expect(items.map((i) => [i.qid, i.type, i.readershipNote])).toEqual([
      ['Q963472', 'memorial', guidedBarNote({ qid: 'Q963472', editions: 20 }, read, BARS)],
      // 18,000 readers with a guide is over 0.8 of the 20,871 a marked work enters at.
      ['Q5', 'memorial', guidedBarNote({ qid: 'Q5', editions: STAYS_AT - 1 }, read, BARS)],
    ]);
    expect(filtered).toEqual([{ externalId: 'Q4', name: 'Fell', reason: below('Q4', STAYS_AT - 1, read), type: 'memorial' }]);
  });
});
