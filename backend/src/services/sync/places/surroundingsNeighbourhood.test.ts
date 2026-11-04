/**
 * ADR-0181's neighbourhood: the places within the radius whose density is
 * within the ratio of the candidate's, the density a place's distance to its
 * 20th-nearest place of the pool. The candidates are real places with the
 * signals the review's extract read for them (#2297: the subset of
 * 2026-10-19, the readership year to 2026-09); the places around them are a
 * schematic of the two densities they stand between, a city's core and the
 * region around it.
 */

import { describe, expect, it } from 'vitest';
import {
  chordOfKm, densityNear, densityOf, kmOfChord, SphereIndex, surroundingsNear, surroundingsOf, type NeighbourSignals, type SpherePoint,
} from './surroundingsNeighbourhood.js';
import { SURROUNDINGS_CUT, surroundingsVerdict } from './surroundingsCut.js';

/** A degree of latitude in km, on the sphere the distances are read on. */
const KM_PER_DEGREE = (6371.0088 * Math.PI) / 180;

/** A line of points `stepKm` apart northward from a start. */
const meridian = (lat: number, lon: number, n: number, stepKm: number): SpherePoint[] =>
  Array.from({ length: n }, (_, i) => ({ lat: lat + (i * stepKm) / KM_PER_DEGREE, lon }));

/** A square grid of points `stepKm` apart around a centre. */
function grid(lat: number, lon: number, side: number, stepKm: number): SpherePoint[] {
  const out: SpherePoint[] = [];
  const dLat = stepKm / KM_PER_DEGREE;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i < side; i++) {
    for (let j = 0; j < side; j++) out.push({ lat: lat + (i - (side - 1) / 2) * dLat, lon: lon + (j - (side - 1) / 2) * dLon });
  }
  return out;
}

describe('a place measured against the index without being one of its points (#2171)', () => {
  // Places a kilometre apart along a meridian, and a named place standing where the middle one stands.
  const line = meridian(50, 10, 41, 1);
  const signals: NeighbourSignals[] = line.map((_, i) => ({ editions: i, guideEditions: 0, readers: 1_000 * i }));
  const shape = { radiusKm: 150, best: 3, densityRatio: 4 };

  it('reads its density and surroundings as a point of the index there would, itself among them', () => {
    const index = new SphereIndex(line);
    const density = Float64Array.from(line.map((_, i) => densityOf(index, i, 20)));
    const place = { ...line[20], editions: 99, guideEditions: 5, readers: 500_000 };
    // Its twentieth-nearest place of the index is ten kilometres off, as the middle point's twentieth other is.
    expect(densityNear(index, place, 20)).toBeCloseTo(densityOf(index, 20, 20), 6);
    const near = surroundingsNear(index, signals, density, { ...place, density: densityNear(index, place, 20) }, shape);
    // Every place of the line, and itself: its own signals lead.
    expect(near.groupSize).toBe(line.length + 1);
    expect(near.topEditions).toEqual([99, 40, 39]);
    expect(near.topGuideEditions).toEqual([5]);
  });

  it('is no neighbour of any point of the index: their surroundings are the index\'s alone', () => {
    const index = new SphereIndex(line);
    const density = Float64Array.from(line.map((_, i) => densityOf(index, i, 20)));
    const before = surroundingsOf(index, signals, density, 20, shape);
    // A named place is measured from outside the index, so nothing it is changes the middle point's surroundings.
    surroundingsNear(index, signals, density, { ...line[20], editions: 99, guideEditions: 5, readers: 500_000, density: 10 }, shape);
    expect(surroundingsOf(index, signals, density, 20, shape)).toEqual(before);
    expect(before.groupSize).toBe(line.length);
  });
});

describe('the sphere index', () => {
  it('finds every point within a distance and the k-th nearest one, as a scan of every pair does', () => {
    const points = [...grid(55.75, 37.62, 30, 0.4), ...grid(55.2, 37.5, 12, 8), ...meridian(-40, 170, 40, 25)];
    const index = new SphereIndex(points);
    const unit = points.map(({ lat, lon }) => {
      const a = (lat * Math.PI) / 180, b = (lon * Math.PI) / 180;
      return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)];
    });
    const km = (i: number, j: number) => kmOfChord(Math.hypot(unit[i][0] - unit[j][0], unit[i][1] - unit[j][1], unit[i][2] - unit[j][2]));
    for (const i of [0, 450, 899, 950, 1043, 1060, points.length - 1]) {
      const sorted = points.map((_, j) => km(i, j)).sort((a, b) => a - b);
      expect(densityOf(index, i, 20)).toBeCloseTo(Math.max(sorted[20], 0.01), 9);
      const within: number[] = [];
      index.forEachWithin(i, chordOfKm(60), (j) => within.push(j));
      expect(within.sort((a, b) => a - b)).toEqual(points.map((_, j) => j).filter((j) => km(i, j) <= 60));
    }
  });

  it('reads a place\'s density as the distance to its 20th-nearest other place', () => {
    // Places a kilometre apart along a meridian: the middle one's twenty nearest are the ten on either side.
    const index = new SphereIndex(meridian(50, 10, 41, 1));
    expect(densityOf(index, 20, 20)).toBeCloseTo(10, 6);
    // The first one's twenty nearest all lie north of it.
    expect(densityOf(index, 0, 20)).toBeCloseTo(20, 6);
  });

  it('floors the density of places sharing one coordinate, and reads a pool smaller than k to its farthest place', () => {
    const same = new SphereIndex(Array.from({ length: 25 }, () => ({ lat: 41.9, lon: 12.5 })));
    expect(densityOf(same, 3, 20)).toBe(0.01);
    expect(densityOf(new SphereIndex(meridian(50, 10, 5, 2)), 0, 20)).toBeCloseTo(8, 6);
  });
});

const shape = { radiusKm: SURROUNDINGS_CUT.radiusKm, best: SURROUNDINGS_CUT.best, densityRatio: SURROUNDINGS_CUT.densityRatio };

/**
 * A city's core and the region around it: `core` places 150 m apart round the
 * centre, read like a capital's best, and a region of places `regionStepKm`
 * apart round the candidate, read like a region's churches. The candidate is
 * the last place.
 */
function cityAndRegion(
  centre: SpherePoint, candidate: SpherePoint & NeighbourSignals, regionStepKm: number, core: NeighbourSignals, region: NeighbourSignals,
) {
  const corePoints = grid(centre.lat, centre.lon, 20, 0.15);
  const regionPoints = grid(candidate.lat, candidate.lon, 9, regionStepKm).filter((p) => p.lat !== candidate.lat || p.lon !== candidate.lon);
  const points = [...corePoints, ...regionPoints, candidate];
  const signals: NeighbourSignals[] = [...corePoints.map(() => core), ...regionPoints.map(() => region), candidate];
  const index = new SphereIndex(points);
  const density = Float64Array.from(points, (_, i) => densityOf(index, i, SURROUNDINGS_CUT.densityNeighbours));
  return { index, signals, density, at: points.length - 1, core: corePoints.length };
}

describe('a place on a dense core\'s edge is measured against the edge (ADR-0181)', () => {
  it('measures the Vladychny Monastery in Serpukhov against the Moscow region\'s places, not against Moscow\'s core', () => {
    // The Vladychny Monastery (Q4105619): three editions, one Wikivoyage edition, 7,920 readers a year,
    // about 95 km south of the Kremlin, whose core is well within 150 km of it.
    const vladychny = { lat: 54.8987, lon: 37.3991, editions: 3, guideEditions: 1, readers: 7_920 };
    const moscow = cityAndRegion({ lat: 55.752, lon: 37.6175 }, vladychny, 3,
      { editions: 40, guideEditions: 6, readers: 200_000 }, { editions: 5, guideEditions: 1, readers: 9_000 });
    const around = surroundingsOf(moscow.index, moscow.signals, moscow.density, moscow.at, shape);
    // The region's eighty places and the monastery itself; none of the core's four hundred.
    expect(around.groupSize).toBe(81);
    expect(around.topGuideEditions[0]).toBe(1);
    const v = surroundingsVerdict(vladychny, around);
    expect(v.in && v.note.startsWith('In the surroundings tier by the guides: within 150 km, 81 places of its density:')).toBe(true);

    // In a plain circle of the same radius the core sets the references, and the monastery's one guide is under a quarter of six.
    const circle = surroundingsOf(moscow.index, moscow.signals, moscow.density, moscow.at, { ...shape, densityRatio: Infinity });
    expect(circle.groupSize).toBe(81 + moscow.core);
    expect(surroundingsVerdict(vladychny, circle).in).toBe(false);
  });

  it('measures Valvisciolo Abbey in Lazio against the places of Lazio outside Rome', () => {
    // Valvisciolo Abbey (Q2820750) near Sermoneta: four editions, one Wikivoyage edition, 10,538 readers a year, 60 km from Rome.
    const valvisciolo = { lat: 41.5680497, lon: 12.9790004, editions: 4, guideEditions: 1, readers: 10_538 };
    const lazio = cityAndRegion({ lat: 41.8986, lon: 12.4768 }, valvisciolo, 2,
      { editions: 60, guideEditions: 7, readers: 1_300_000 }, { editions: 6, guideEditions: 2, readers: 9_000 });
    const around = surroundingsOf(lazio.index, lazio.signals, lazio.density, lazio.at, shape);
    expect(around.groupSize).toBe(81);
    // The guide reference is Lazio's two, and the abbey's one reaches a quarter of it; Rome's seven would ask for 1.75.
    const v = surroundingsVerdict(valvisciolo, around);
    expect(v.in && v.note.startsWith('In the surroundings tier by the guides:')).toBe(true);
    expect(surroundingsVerdict(valvisciolo, surroundingsOf(lazio.index, lazio.signals, lazio.density, lazio.at, { ...shape, densityRatio: Infinity })).in).toBe(false);
  });

  it('counts a neighbour whose density is four times the candidate\'s, and not one past it', () => {
    // Three places: the candidate, and two neighbours 1 km away whose densities are 4 and 4.01 times its own.
    const index = new SphereIndex([{ lat: 50, lon: 10 }, ...meridian(50 + 1 / KM_PER_DEGREE, 10, 2, 0.001)]);
    const signals = [{ editions: 2, guideEditions: 0, readers: 5_000 }, { editions: 9, guideEditions: 2, readers: 1 }, { editions: 7, guideEditions: 1, readers: 2 }];
    const around = surroundingsOf(index, signals, Float64Array.from([2, 8, 8.02]), 0, shape);
    expect(around).toEqual({ groupSize: 2, topEditions: [9, 2], topGuideEditions: [2], topReaders: [5_000, 1] });
    // And a place a quarter as dense, either way.
    expect(surroundingsOf(index, signals, Float64Array.from([2, 0.5, 0.49]), 0, shape).groupSize).toBe(2);
  });

  it('reads a group\'s neighbours over its own places alone, the candidate always among them', () => {
    const index = new SphereIndex(meridian(50, 10, 5, 1));
    const signals = Array.from({ length: 5 }, (_, i) => ({ editions: i + 1, guideEditions: 0, readers: 1_000 * (i + 1) }));
    const around = surroundingsOf(index, signals, new Float64Array(5).fill(1), 0, shape, (j) => j % 2 === 1);
    expect(around).toEqual({ groupSize: 3, topEditions: [4, 2, 1], topGuideEditions: [], topReaders: [4_000, 2_000, 1_000] });
  });
});
