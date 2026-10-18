import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import {
  classesOfItems, classesUnder, componentNumbers, itemsInBoxes, itemsUnder, partsOfSites, placesOf, rangesOf, registerCodesOf,
  settlementsAmong,
} from './componentItems.js';

/**
 * The component-item search's questions answered from the local subset
 * (#1435), against PostgreSQL. Fixture items (Q984xx) beside the real classes
 * the rules name: human settlement (Q486972), fortification (Q57821),
 * archaeological site (Q839954) and the Samian Ware discovery site class
 * (Q102202066). A serial site's item names two parts; a castrum near Bologa
 * stands beside a village, a dig record and a referenced item; one fort stands
 * on Taveuni, across the antimeridian.
 */

const SETTLEMENT = 'Q486972';
const FORTIFICATION = 'Q57821';
const DIG = 'Q839954';
const SAMIAN = 'Q102202066';
const CASTRUM = 'Q98480';
const VILLAGE = 'Q98481';
const SITE = 'Q98400';
const PART = 'Q98401';
const OTHER_PART = 'Q98402';
const FORT = 'Q98410';
const VILLAGE_ITEM = 'Q98411';
const RECORD = 'Q98412';
const REFERENCED = 'Q98413';
const FAR = 'Q98414';
const TAVEUNI_FORT = 'Q98415';
const MOON_CRATER = 'Q98416';
const PLACE = 'Q98420';
const UNNAMED_PLACE = 'Q98421';

let n = 0;
async function claim(subject: string, property: string, value: string | object, rank: -1 | 0 | 1 = 0): Promise<void> {
  n += 1;
  const item = typeof value === 'string' && /^Q\d+$/.test(value) ? value : null;
  await pool.query(
    `INSERT INTO wikidata_claims (subject, property, statement_id, rank, value_item, value) VALUES ($1, $2, $3, $4, $5, $6)`,
    [subject, property, `${subject}$ci-${n}`, rank, item, item ? null : JSON.stringify(value)],
  );
}
const at = (latitude: number, longitude: number) => ({ latitude, longitude, globe: 'http://www.wikidata.org/entity/Q2' });

beforeAll(async () => {
  await pool.query('TRUNCATE wikidata_claims, wikidata_labels, wikidata_class_closure');
  // The site's parts: one with a coordinate and a reference, one stated only as deprecated.
  await claim(PART, 'P361', SITE);
  await claim(PART, 'P625', at(46.8851, 22.8754));
  await claim(PART, 'P757', '9840-002');
  await claim(OTHER_PART, 'P361', SITE, -1);
  // Classes, read by best rank: the preferred one outranks the normal one beside it.
  await claim(FORT, 'P31', CASTRUM, 1);
  await claim(FORT, 'P31', VILLAGE);
  await claim(FORT, 'P625', at(46.886, 22.876));
  await claim(FORT, 'P1770', 'CJ-I-s-A-07104');
  await claim(VILLAGE_ITEM, 'P31', VILLAGE);
  await claim(VILLAGE_ITEM, 'P625', at(46.887, 22.874));
  await claim(RECORD, 'P31', CASTRUM);
  await claim(RECORD, 'P31', 'Q98482');
  await claim(RECORD, 'P625', at(46.884, 22.875));
  await claim(REFERENCED, 'P31', CASTRUM);
  await claim(REFERENCED, 'P625', at(46.885, 22.877));
  await claim(REFERENCED, 'P757', '9840-005');
  await claim(FAR, 'P31', CASTRUM);
  await claim(FAR, 'P625', at(47.5, 22.875));
  await claim(TAVEUNI_FORT, 'P31', CASTRUM);
  await claim(TAVEUNI_FORT, 'P625', at(-16.85, -179.98));
  // A point on the Moon whose latitude and longitude fall inside Bologa's box, and a part with one beside its Earth one.
  await claim(MOON_CRATER, 'P31', CASTRUM);
  await claim(MOON_CRATER, 'P625', { latitude: 46.886, longitude: 22.876, globe: 'http://www.wikidata.org/entity/Q405' });
  await claim(PART, 'P625', { latitude: 1, longitude: 2, globe: 'http://www.wikidata.org/entity/Q405' });
  // Numbers: one under another inscription, one deprecated, one a whole site's.
  await claim(FAR, 'P757', '9840ter-003');
  await claim(FAR, 'P757', '9840-009', -1);
  await claim(SITE, 'P757', '9840');
  // Where the fort stands: a named place with a coordinate and a reference, and one with no English name.
  await claim(FORT, 'P131', PLACE);
  await claim(FORT, 'P276', UNNAMED_PLACE);
  await claim(PLACE, 'P625', at(46.888, 22.873));
  await claim(PLACE, 'P757', '9840-006');
  await pool.query(
    `INSERT INTO wikidata_labels (id, language, label) VALUES ($1, 'en', 'Bologa'), ($1, 'mul', 'Bologa'), ($1, 'de', 'Bologa (Dorf)'),
                                                              ($2, 'de', 'Ein Ort')`,
    [PLACE, UNNAMED_PLACE],
  );
  // The class tree: a castrum is a settlement and a fortification; a village a settlement only;
  // the dig record's second class sits under the Samian Ware class.
  await pool.query(
    `INSERT INTO wikidata_class_closure (class, ancestor) VALUES
       ($1, $1), ($1, $2), ($1, $3), ($4, $4), ($4, $2), ('Q98482', 'Q98482'), ('Q98482', $5), ($5, $5), ($5, $6)`,
    [CASTRUM, SETTLEMENT, FORTIFICATION, VILLAGE, SAMIAN, DIG],
  );
});

afterAll(async () => {
  await pool.query('TRUNCATE wikidata_claims, wikidata_labels, wikidata_class_closure');
  await pool.end();
});

const progress = {};

describe('the component-item search, read from the subset (#1435)', () => {
  it("reads an item's classes by best rank", async () => {
    const classes = await classesOfItems([FORT, VILLAGE_ITEM, 'Q98499'], progress);
    expect(classes.get(FORT)).toEqual([CASTRUM]);
    expect(classes.get(VILLAGE_ITEM)).toEqual([VILLAGE]);
    expect(classes.has('Q98499')).toBe(false);
  });

  it("reads the register codes an item carries", async () => {
    expect((await registerCodesOf([FORT, VILLAGE_ITEM], progress)).get(FORT)).toEqual([{ property: 'P1770', code: 'CJ-I-s-A-07104' }]);
  });

  it("reads the parts a site's item names, with their coordinates and references, never a deprecated statement", async () => {
    expect((await partsOfSites([SITE], progress)).get(SITE)).toEqual([
      { item: PART, labels: [], coords: [[46.8851, 22.8754]], classes: [], references: ['9840-002'] },
    ]);
  });

  it("reads every item carrying a component's number, not one stated only as deprecated nor a whole site's", async () => {
    expect(await componentNumbers(progress)).toEqual([
      { item: PART, labels: [], coords: [[46.8851, 22.8754]], classes: [], references: ['9840-002'] },
      { item: REFERENCED, labels: [], coords: [[46.885, 22.877]], classes: [], references: ['9840-005'] },
      { item: FAR, labels: [], coords: [[47.5, 22.875]], classes: [], references: ['9840ter-003'] },
      { item: PLACE, labels: [], coords: [[46.888, 22.873]], classes: [], references: ['9840-006'] },
    ]);
  });

  it('reads what stands in each box, of the classes asked, less a referenced item, a record of a dig and a point on another globe', async () => {
    const bologa = { south: 46.83, north: 46.94, west: 22.8, east: 22.95 };
    const byBox = await itemsInBoxes([bologa], [CASTRUM, VILLAGE], progress);
    expect(byBox.get(0)).toEqual([
      // The fort's normal statement of village is outranked by its preferred one.
      { item: FORT, labels: [], coords: [[46.886, 22.876]], classes: [CASTRUM] },
      { item: VILLAGE_ITEM, labels: [], coords: [[46.887, 22.874]], classes: [VILLAGE] },
    ]);
    // Asked only for villages, the castrum is not in the answer.
    expect((await itemsInBoxes([bologa], [VILLAGE], progress)).get(0)?.map(c => c.item)).toEqual([VILLAGE_ITEM]);
  });

  it('reads a box that runs past the antimeridian on both sides of it', async () => {
    const taveuni = { south: -16.9, north: -16.8, west: 179.9, east: 180.05 };
    expect(rangesOf(taveuni)).toEqual([
      { south: -16.9, north: -16.8, west: 179.9, east: 180 },
      { south: -16.9, north: -16.8, west: -180, east: 180.05 - 360 },
    ]);
    const byBox = await itemsInBoxes([{ south: 46.83, north: 46.94, west: 22.8, east: 22.95 }, taveuni], [CASTRUM], progress);
    expect(byBox.get(1)?.map(c => c.item)).toEqual([TAVEUNI_FORT]);
  });

  it('stops a read of the whole subset once the pass is cancelled', async () => {
    const cancelled = { isCancelled: () => true };
    await expect(itemsInBoxes([{ south: 46.83, north: 46.94, west: 22.8, east: 22.95 }], [CASTRUM], cancelled)).rejects.toThrow();
    await expect(componentNumbers(cancelled)).rejects.toThrow();
  });

  it('tells a settlement by its classes in the tree, a castrum filed under fortification too being none', async () => {
    expect([...await settlementsAmong([FORT, VILLAGE_ITEM, RECORD], progress)]).toEqual([VILLAGE_ITEM]);
    expect([...await settlementsAmong([CASTRUM, VILLAGE], progress, true)]).toEqual([VILLAGE]);
  });

  it('tells the classes under a root, the root a kind of itself, and an unrelated class none', async () => {
    expect([...await classesUnder([CASTRUM, VILLAGE, 'Q98482'], [FORTIFICATION], progress)]).toEqual([CASTRUM]);
    expect([...await classesUnder([VILLAGE, 'Q98482'], [VILLAGE], progress)]).toEqual([VILLAGE]);
  });

  it('tells the items with any class under a root, a normal-ranked one beside a preferred one included', async () => {
    // The fort is a castrum first and a village second: the second class still counts.
    expect([...await itemsUnder([FORT, VILLAGE_ITEM, RECORD], [VILLAGE], progress)]).toEqual([FORT, VILLAGE_ITEM]);
    expect([...await itemsUnder([FORT, VILLAGE_ITEM, RECORD], [FORTIFICATION], progress)]).toEqual([FORT, RECORD]);
  });

  it('reads where an item stands, by its English and multilingual names, with the place\'s coordinate and reference', async () => {
    expect((await placesOf([FORT, VILLAGE_ITEM], progress))).toEqual(new Map([
      [FORT, [{ item: PLACE, names: ['Bologa'], coords: [[46.888, 22.873]], referenced: true }]],
    ]));
  });
});
