/**
 * ADR-0181: the surroundings tier measures a place against the neighbours of
 * its own density within the radius, so a monastery of the Moscow region is
 * measured against the region's places and not against Moscow's core. A
 * place's density is its distance to the `densityNeighbours`-th nearest place
 * of the pool; a neighbour counts toward a candidate's group and references
 * only while its own density is within a factor of `densityRatio` of the
 * candidate's, either way. The candidate always counts.
 *
 * Distances are great-circle distances on a sphere of the Earth's mean radius,
 * as the measurement behind the ADR read them (#2297), through a static k-d
 * tree over the places' unit vectors: the pool is in the run's memory already,
 * and two million nearest-neighbour questions are seconds here and many minutes
 * as one indexed query each.
 */

import type { Surroundings } from './surroundingsCut.js';

/** The Earth's mean radius, in km. */
const EARTH_KM = 6371.0088;
/** The leaf size of the tree: a node this small is scanned whole. */
const LEAF = 32;
/**
 * The smallest density a place is read at, in km: places sharing one
 * coordinate would otherwise have none, and a ratio against nothing.
 */
const DENSITY_FLOOR_KM = 0.01;

/** The chord through the unit sphere that spans `km` along its surface. */
export const chordOfKm = (km: number): number => 2 * Math.sin(km / (2 * EARTH_KM));

/** The distance along the surface that a chord through the unit sphere spans. */
export const kmOfChord = (chord: number): number => 2 * EARTH_KM * Math.asin(Math.min(1, chord / 2));

/** A point of the pool, by its coordinate. */
export interface SpherePoint {
  lat: number;
  lon: number;
}

/**
 * A static k-d tree over points on the sphere, held as unit vectors: a range
 * question (every point within a chord) and a nearest-neighbour one (the
 * chord to the k-th nearest point). Points are named by their position in the
 * list the tree was built from.
 */
export class SphereIndex {
  /** Each point's unit vector, by its position in the list. */
  private readonly at: Float64Array;
  /** The points in the tree's order. */
  private readonly ids: Int32Array;
  /** The unit vectors in the tree's order. */
  private readonly coords: Float64Array;

  constructor(points: readonly SpherePoint[]) {
    const n = points.length;
    this.at = new Float64Array(3 * n);
    points.forEach((p, i) => {
      const lat = (p.lat * Math.PI) / 180;
      const lon = (p.lon * Math.PI) / 180;
      this.at[3 * i] = Math.cos(lat) * Math.cos(lon);
      this.at[3 * i + 1] = Math.cos(lat) * Math.sin(lon);
      this.at[3 * i + 2] = Math.sin(lat);
    });
    this.ids = Int32Array.from({ length: n }, (_, i) => i);
    this.coords = this.at.slice();
    if (n > 0) this.build(0, n - 1, 0);
  }

  get size(): number {
    return this.ids.length;
  }

  /** Every point within `chord` of point `i`, itself included, with its squared chord. */
  forEachWithin(i: number, chord: number, visit: (j: number, chordSquared: number) => void): void {
    const r2 = chord * chord;
    const stack = [0, this.ids.length - 1, 0];
    while (stack.length) {
      const axis = stack.pop()!, right = stack.pop()!, left = stack.pop()!;
      if (right - left <= LEAF) {
        this.scan(i, left, right, r2, visit);
        continue;
      }
      const m = (left + right) >> 1;
      this.scan(i, m, m, r2, visit);
      const q = this.at[3 * i + axis];
      const c = this.coords[3 * m + axis];
      const next = (axis + 1) % 3;
      if (q - chord <= c) stack.push(left, m - 1, next);
      if (q + chord >= c) stack.push(m + 1, right, next);
    }
  }

  /** The chord from point `i` to the `k`-th nearest point of the tree, itself counted first (at nought). */
  kthChord(i: number, k: number): number {
    const best = new Float64Array(k).fill(Infinity);
    this.nearest(i, 0, this.ids.length - 1, 0, best);
    return Math.sqrt(best[k - 1]);
  }

  /** The squared chord from the tree's point at `p` to point `i`. */
  private squared(p: number, i: number): number {
    const dx = this.coords[3 * p] - this.at[3 * i];
    const dy = this.coords[3 * p + 1] - this.at[3 * i + 1];
    const dz = this.coords[3 * p + 2] - this.at[3 * i + 2];
    return dx * dx + dy * dy + dz * dz;
  }

  /** Visits the tree's points at `left..right` within the squared chord `r2` of point `i`. */
  private scan(i: number, left: number, right: number, r2: number, visit: (j: number, chordSquared: number) => void): void {
    for (let p = left; p <= right; p++) {
      const d2 = this.squared(p, i);
      if (d2 <= r2) visit(this.ids[p], d2);
    }
  }

  /** Keeps the `best.length` smallest squared chords to point `i` seen, smallest first. */
  private nearest(i: number, left: number, right: number, axis: number, best: Float64Array): void {
    if (right - left <= LEAF) {
      for (let p = left; p <= right; p++) offer(best, this.squared(p, i));
      return;
    }
    const m = (left + right) >> 1;
    offer(best, this.squared(m, i));
    const delta = this.at[3 * i + axis] - this.coords[3 * m + axis];
    const next = (axis + 1) % 3;
    // The near side first, so the far one is mostly pruned by what it found.
    const below = delta < 0;
    const near = below ? left : m + 1;
    const nearEnd = below ? m - 1 : right;
    const far = below ? m + 1 : left;
    const farEnd = below ? right : m - 1;
    this.nearest(i, near, nearEnd, next, best);
    if (delta * delta <= best[best.length - 1]) this.nearest(i, far, farEnd, next, best);
  }

  /** Sorts the tree's slice `left..right` around its median on `axis`, then each half on the next axis. */
  private build(left: number, right: number, axis: number): void {
    if (right - left <= LEAF) return;
    const m = (left + right) >> 1;
    this.select(m, left, right, axis);
    this.build(left, m - 1, (axis + 1) % 3);
    this.build(m + 1, right, (axis + 1) % 3);
  }

  /** Floyd and Rivest's selection: the k-th smallest on `axis` at position k, the smaller before it. */
  private select(k: number, left: number, right: number, axis: number): void {
    while (right > left) {
      if (right - left > 600) this.sample(k, left, right, axis);
      const j = this.partition(k, left, right, axis);
      if (j <= k) left = j + 1;
      if (k <= j) right = j - 1;
    }
  }

  /** Selection's first pass over a sample of a long slice, which brings the k-th near its place. */
  private sample(k: number, left: number, right: number, axis: number): void {
    const n = right - left + 1;
    const m = k - left + 1;
    const z = Math.log(n);
    const s = 0.5 * Math.exp((2 * z) / 3);
    const sd = 0.5 * Math.sqrt((z * s * (n - s)) / n) * (m < n / 2 ? -1 : 1);
    this.select(k, Math.max(left, Math.floor(k - (m * s) / n + sd)), Math.min(right, Math.floor(k + ((n - m) * s) / n + sd)), axis);
  }

  /** Splits `left..right` around the value at k on `axis`, and returns where that value lands. */
  private partition(k: number, left: number, right: number, axis: number): number {
    const t = this.coords[3 * k + axis];
    let i = left;
    let j = right;
    this.swap(left, k);
    if (this.coords[3 * right + axis] > t) this.swap(left, right);
    while (i < j) {
      this.swap(i, j);
      i++;
      j--;
      while (this.coords[3 * i + axis] < t) i++;
      while (this.coords[3 * j + axis] > t) j--;
    }
    if (this.coords[3 * left + axis] === t) this.swap(left, j);
    else {
      j++;
      this.swap(j, right);
    }
    return j;
  }

  private swap(a: number, b: number): void {
    const id = this.ids[a];
    this.ids[a] = this.ids[b];
    this.ids[b] = id;
    for (let d = 0; d < 3; d++) {
      const c = this.coords[3 * a + d];
      this.coords[3 * a + d] = this.coords[3 * b + d];
      this.coords[3 * b + d] = c;
    }
  }
}

/** Inserts a squared chord into the sorted list of the smallest, where it belongs among them. */
function offer(best: Float64Array, d2: number): void {
  let p = best.length - 1;
  if (d2 >= best[p]) return;
  while (p > 0 && best[p - 1] > d2) {
    best[p] = best[p - 1];
    p--;
  }
  best[p] = d2;
}

/**
 * The density of point `i`: the distance in km to its `k`-th nearest other
 * point of the index (its farthest, in an index of no more than `k`), floored
 * at `DENSITY_FLOOR_KM`.
 */
export function densityOf(index: SphereIndex, i: number, k: number): number {
  return Math.max(kmOfChord(index.kthChord(i, Math.min(k + 1, index.size))), DENSITY_FLOOR_KM);
}

/** A pool place's signals, as the references read them. */
export interface NeighbourSignals {
  editions: number;
  guideEditions: number;
  readers: number;
}

/** The neighbourhood's shape: how far it reaches, and how alike a neighbour's density must be. */
export interface NeighbourhoodShape {
  radiusKm: number;
  /** How many of the best places set each reference. */
  best: number;
  /** A neighbour counts while its density over the candidate's is within this factor, either way. */
  densityRatio: number;
}

/** Inserts a signal into the highest-first list of the best, where it belongs among them. */
function keepBest(top: number[], value: number, best: number): void {
  if (value <= 0 || (top.length === best && value <= top[best - 1])) return;
  let p = top.length < best ? top.length : best - 1;
  top[p] = value;
  while (p > 0 && top[p - 1] < value) {
    top[p] = top[p - 1];
    top[p - 1] = value;
    p--;
  }
}

/**
 * The surroundings of candidate `i`: the places within the radius whose
 * density is within the ratio of the candidate's (`density`, by position),
 * among those `inGroup` names (every place where it is absent), the candidate
 * itself always among them; their count and the best places' signals, over
 * the places that carry each signal at all, highest first.
 */
export function surroundingsOf(
  index: SphereIndex, signals: readonly NeighbourSignals[], density: Float64Array, i: number, shape: NeighbourhoodShape,
  inGroup?: (j: number) => boolean,
): Surroundings {
  const own = density[i];
  const low = 1 / shape.densityRatio;
  let groupSize = 0;
  const topEditions: number[] = [];
  const topGuideEditions: number[] = [];
  const topReaders: number[] = [];
  index.forEachWithin(i, chordOfKm(shape.radiusKm), (j) => {
    if (j !== i) {
      if (inGroup && !inGroup(j)) return;
      const ratio = density[j] / own;
      if (!(ratio >= low && ratio <= shape.densityRatio)) return;
    }
    groupSize += 1;
    const s = signals[j];
    keepBest(topEditions, s.editions, shape.best);
    keepBest(topGuideEditions, s.guideEditions, shape.best);
    keepBest(topReaders, s.readers, shape.best);
  });
  return { groupSize, topEditions, topGuideEditions, topReaders };
}
