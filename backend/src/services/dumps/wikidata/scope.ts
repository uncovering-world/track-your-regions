/**
 * Which items the local Wikidata subset keeps (ADR-0101 decision 2, narrowed
 * by ADR-0105), decided by a first pass over the dump that scans every line
 * (`entityLine.ts`) and keeps nothing but ids:
 *
 * - the seeds: every item with a coordinate (P625) and every class (P279);
 * - the classes a seed is an instance of (its P31 values);
 * - the items a seed names through a place, part, collection or based-on property, and
 *   the items that name a seed through one: a painting names its museum, a
 *   find its find spot;
 * - the items a seed depicts (P180) or commemorates (P547): whether the
 *   Statue of Unity depicts a person is a question about Sardar Vallabhbhai
 *   Patel, who has no coordinate (#1832);
 * - every item whose containment chain (P276, P361, P195) reaches an item with
 *   a coordinate, with every item on the way: the Dendera zodiac lies in Room
 *   325, which is part of the Louvre Palace, and neither the zodiac nor the
 *   room has a coordinate of its own.
 *
 * Every property entity is kept. A line's size is recorded too, so the pass
 * says what keeping the scope would cost before anything is written.
 */

import { EdgeList, IdSet, Numbers } from './idSets.js';
import { entityOf, forEachMainItemValue, hasMainValue } from './entityLine.js';

const COORDINATE = 625;
const SUBCLASS_OF = 279;
const INSTANCE_OF = 31;
/** The properties through which a kept item brings in its neighbours, in both directions; P144 keeps a cast's group. */
export const PLACE_PROPERTIES = [131, 276, 361, 527, 195, 189, 144] as const;
/**
 * The properties whose values a seed brings in, one way and one hop: what it
 * depicts and what it commemorates. Not walked and not followed back — a
 * person is depicted by thousands of paintings, none of which that makes a
 * place.
 */
export const SUBJECT_PROPERTIES = [180, 547] as const;
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
  place: PLACE_PROPERTIES, chain: CHAIN_PROPERTIES, chainDepth: CHAIN_DEPTH, subject: SUBJECT_PROPERTIES,
});

const PLACE_TAG = new Map<number, number>(PLACE_PROPERTIES.map((property, index) => [property, index]));
const CHAIN_TAGS = new Set<number>(CHAIN_PROPERTIES.map(property => PLACE_TAG.get(property)!));
const SUBJECT = new Set<number>(SUBJECT_PROPERTIES);

export interface ScopeCounts {
  items: number;
  properties: number;
  coordinates: number;
  classes: number;
  seeds: number;
  /** Items kept as a seed's class, its place, part or collection, or what it depicts or commemorates. */
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

/** What pass 1 learns from a batch of lines (`ScopeCollector.absorb`), in typed arrays a worker hands over whole. */
export interface ScopeFacts {
  /** Every line of the batch, entity or not. */
  lines: number;
  items: number;
  /** The characters of every entity line. */
  bytes: number;
  properties: Uint32Array;
  /** Item, line length; in pairs. */
  sizes: Uint32Array;
  coordinates: Uint32Array;
  classes: Uint32Array;
  /** Items a seed names as its class, through a place property, or as what it depicts or commemorates. */
  neighbours: Uint32Array;
  /** From, to, place tag; in threes. */
  edges: Uint32Array;
}

/**
 * Pass 1's reading of a batch of lines, a pure function: a worker thread and
 * the main thread run it alike (#1479).
 */
export function scopeFactsOf(lines: readonly string[]): ScopeFacts {
  let items = 0;
  let bytes = 0;
  const properties = new Numbers();
  const sizes = new Numbers();
  const coordinates = new Numbers();
  const classes = new Numbers();
  const neighbours = new Numbers();
  const edges = new Numbers();
  for (const line of lines) {
    const entity = entityOf(line);
    if (!entity) continue;
    bytes += line.length;
    if (entity.kind === 'property') {
      properties.push(entity.id);
      continue;
    }
    items += 1;
    sizes.push(entity.id);
    sizes.push(line.length);
    const coordinate = hasMainValue(line, COORDINATE);
    const isClass = hasMainValue(line, SUBCLASS_OF);
    if (coordinate) coordinates.push(entity.id);
    if (isClass) classes.push(entity.id);
    const seed = coordinate || isClass;
    forEachMainItemValue(line, (property, item) => {
      const tag = PLACE_TAG.get(property);
      if (seed && (property === INSTANCE_OF || tag !== undefined || SUBJECT.has(property))) neighbours.push(item);
      if (tag !== undefined) {
        edges.push(entity.id);
        edges.push(item);
        edges.push(tag);
      }
    });
  }
  return {
    lines: lines.length, items, bytes, properties: properties.take(), sizes: sizes.take(), coordinates: coordinates.take(),
    classes: classes.take(), neighbours: neighbours.take(), edges: edges.take(),
  };
}

/** The first pass: feed it every line, or batches' facts (`absorb`), then ask `finish()` for the scope. */
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
    this.absorb(scopeFactsOf([line]));
  }

  absorb(facts: ScopeFacts): void {
    this.items += facts.items;
    this.bytes += facts.bytes;
    for (const id of facts.properties) this.properties.add(id);
    for (let i = 0; i < facts.sizes.length; i += 2) this.recordSize(facts.sizes[i], facts.sizes[i + 1]);
    for (const id of facts.coordinates) this.coordinates.add(id);
    for (const id of facts.classes) this.classes.add(id);
    for (const id of facts.neighbours) this.seedNeighbours.add(id);
    for (let i = 0; i < facts.edges.length; i += 3) this.edges.push(facts.edges[i], facts.edges[i + 1], facts.edges[i + 2]);
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
