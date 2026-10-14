/**
 * Which items the local Wikidata subset keeps (ADR-0101 decision 2, narrowed
 * by ADR-0105), decided by a first pass over the dump that scans every line
 * (`entityLine.ts`) and keeps nothing but ids:
 *
 * - the seeds: every item with a coordinate (P625) and every class (P279);
 * - the classes a seed is an instance of (its P31 values);
 * - the items a seed names through a place, part or collection property, and
 *   the items that name a seed through one: a painting names its museum, a
 *   find its find spot;
 * - every item whose containment chain (P276, P361, P195) reaches an item with
 *   a coordinate, with every item on the way: the Dendera zodiac lies in Room
 *   325, which is part of the Louvre Palace, and neither the zodiac nor the
 *   room has a coordinate of its own.
 *
 * Every property entity is kept. A line's size is recorded too, so the pass
 * says what keeping the scope would cost before anything is written.
 */

import { EdgeList, IdSet } from './idSets.js';
import { entityOf, forEachMainItemValue, hasMainValue } from './entityLine.js';

const COORDINATE = 625;
const SUBCLASS_OF = 279;
const INSTANCE_OF = 31;
/** The properties through which a kept item brings in its neighbours, in both directions. */
export const PLACE_PROPERTIES = [131, 276, 361, 527, 195, 189] as const;
/** The properties a containment chain follows: location, part of, collection. */
export const CHAIN_PROPERTIES = [276, 361, 195] as const;
/** How far a chain is followed before it is given up as never reaching a coordinate. */
export const CHAIN_DEPTH = 8;

/**
 * The rules above as one value, written into a kept first-pass result
 * (`scopeFile.ts`): a change to any of them makes an earlier result stale
 * without anyone having to remember it. A change to how a line is read
 * (`entityLine.ts`) or to `ScopeCollector` itself raises `SCOPE_VERSION`
 * there instead.
 */
export const SCOPE_RULES = JSON.stringify({
  coordinate: COORDINATE, subclassOf: SUBCLASS_OF, instanceOf: INSTANCE_OF,
  place: PLACE_PROPERTIES, chain: CHAIN_PROPERTIES, chainDepth: CHAIN_DEPTH,
});

const PLACE_TAG = new Map<number, number>(PLACE_PROPERTIES.map((property, index) => [property, index]));
const CHAIN_TAGS = new Set<number>(CHAIN_PROPERTIES.map(property => PLACE_TAG.get(property)!));

export interface ScopeCounts {
  items: number;
  properties: number;
  coordinates: number;
  classes: number;
  seeds: number;
  /** Items kept as a seed's class or a seed's place, part or collection. */
  seedNeighbours: number;
  /** Items kept because they name a seed through a place, part or collection property. */
  namingSeeds: number;
  /** Items kept only for a containment chain that reaches a coordinate. */
  chains: number;
  kept: number;
  edges: number;
  /** The bytes of every line, and of the kept ones. */
  bytes: number;
  keptBytes: number;
}

export interface Scope {
  kept: IdSet;
  properties: IdSet;
  counts: ScopeCounts;
}

/** The first pass: feed it every line, then ask `finish()` for the scope. */
export class ScopeCollector {
  private readonly coordinates = new IdSet();
  private readonly classes = new IdSet();
  private readonly properties = new IdSet();
  private readonly seedNeighbours = new IdSet();
  private readonly edges = new EdgeList();
  private sizes = new Uint32Array(1 << 20);
  private items = 0;
  private bytes = 0;

  line(line: string): void {
    const entity = entityOf(line);
    if (!entity) return;
    this.bytes += line.length;
    if (entity.kind === 'property') {
      this.properties.add(entity.id);
      return;
    }
    this.items += 1;
    this.recordSize(entity.id, line.length);
    const seed = this.classify(entity.id, line);
    forEachMainItemValue(line, (property, item) => {
      if (seed && (property === INSTANCE_OF || PLACE_TAG.has(property))) this.seedNeighbours.add(item);
      const tag = PLACE_TAG.get(property);
      if (tag !== undefined) this.edges.push(entity.id, item, tag);
    });
  }

  finish(): Scope {
    const seeds = new IdSet();
    for (const id of this.coordinates) seeds.add(id);
    for (const id of this.classes) seeds.add(id);
    const kept = new IdSet();
    for (const id of seeds) kept.add(id);
    const before = kept.size;
    for (const id of this.seedNeighbours) kept.add(id);
    const seedNeighbours = kept.size - before;
    const naming = kept.size;
    this.edges.forEach((from, to) => {
      if (seeds.has(to)) kept.add(from);
    });
    const namingSeeds = kept.size - naming;
    const chained = kept.size;
    for (const id of this.chains()) kept.add(id);
    const counts: ScopeCounts = {
      items: this.items,
      properties: this.properties.size,
      coordinates: this.coordinates.size,
      classes: this.classes.size,
      seeds: seeds.size,
      seedNeighbours,
      namingSeeds,
      chains: kept.size - chained,
      kept: kept.size,
      edges: this.edges.size,
      bytes: this.bytes,
      keptBytes: this.keptBytes(kept),
    };
    return { kept, properties: this.properties, counts };
  }

  private classify(id: number, line: string): boolean {
    const coordinate = hasMainValue(line, COORDINATE);
    const isClass = hasMainValue(line, SUBCLASS_OF);
    if (coordinate) this.coordinates.add(id);
    if (isClass) this.classes.add(id);
    return coordinate || isClass;
  }

  /** Every item whose chain through location, part or collection reaches a coordinate within `CHAIN_DEPTH` steps. */
  private chains(): IdSet {
    const reached = new IdSet();
    for (const id of this.coordinates) reached.add(id);
    for (let step = 0; step < CHAIN_DEPTH; step += 1) {
      let grew = false;
      this.edges.forEach((from, to, tag) => {
        if (CHAIN_TAGS.has(tag) && reached.has(to) && reached.add(from)) grew = true;
      });
      if (!grew) break;
    }
    return reached;
  }

  private recordSize(id: number, length: number): void {
    if (id >= this.sizes.length) {
      let capacity = this.sizes.length;
      while (capacity <= id) capacity *= 2;
      const sizes = new Uint32Array(capacity);
      sizes.set(this.sizes);
      this.sizes = sizes;
    }
    this.sizes[id] = length;
  }

  private keptBytes(kept: IdSet): number {
    let total = 0;
    for (const id of kept) total += id < this.sizes.length ? this.sizes[id] : 0;
    return total;
  }
}
