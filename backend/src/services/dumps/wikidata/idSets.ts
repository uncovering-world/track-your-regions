/**
 * Sets and lists of Wikidata item numbers sized for the whole dump: about 140
 * million ids, which a bit each holds in under 20 MB, where a `Set<number>`
 * of the same ids would need gigabytes. They grow as larger ids arrive.
 */

export class IdSet {
  private bits: Uint8Array<ArrayBufferLike> = new Uint8Array(1 << 20);
  private count = 0;

  add(id: number): boolean {
    const byte = id >>> 3;
    if (byte >= this.bits.length) this.grow(byte);
    const mask = 1 << (id & 7);
    if (this.bits[byte] & mask) return false;
    this.bits[byte] |= mask;
    this.count += 1;
    return true;
  }

  has(id: number): boolean {
    const byte = id >>> 3;
    return byte < this.bits.length && (this.bits[byte] & (1 << (id & 7))) !== 0;
  }

  get size(): number {
    return this.count;
  }

  /** The set as bytes, a bit per id, to be kept on disk (`IdSet.fromBytes`). */
  toBytes(): Uint8Array {
    let end = this.bits.length;
    while (end > 0 && this.bits[end - 1] === 0) end -= 1;
    return this.bits.slice(0, end);
  }

  /**
   * The set's bits in memory a worker thread can read without a copy
   * (`IdSet.overShared`); the set is not changed after this.
   */
  toShared(): SharedArrayBuffer {
    const bytes = this.toBytes();
    const shared = new SharedArrayBuffer(Math.max(bytes.length, 1));
    new Uint8Array(shared).set(bytes);
    return shared;
  }

  /** A set over `shared`'s bits, as `toShared` made them: read-only, its size not counted. */
  static overShared(shared: SharedArrayBuffer): IdSet {
    const set = new IdSet();
    set.bits = new Uint8Array(shared);
    return set;
  }

  static fromBytes(bytes: Uint8Array): IdSet {
    const set = new IdSet();
    set.bits = new Uint8Array(Math.max(bytes.length, 1 << 20));
    set.bits.set(bytes);
    for (const value of bytes) {
      for (let v = value; v !== 0; v &= v - 1) set.count += 1;
    }
    return set;
  }

  /** Every id in the set, ascending. */
  *[Symbol.iterator](): IterableIterator<number> {
    for (let byte = 0; byte < this.bits.length; byte += 1) {
      const value = this.bits[byte];
      if (value === 0) continue;
      for (let bit = 0; bit < 8; bit += 1) if (value & (1 << bit)) yield byte * 8 + bit;
    }
  }

  private grow(byte: number): void {
    let length = this.bits.length;
    while (length <= byte) length *= 2;
    const bits = new Uint8Array(length);
    bits.set(this.bits);
    this.bits = bits;
  }
}

/** A growing list of edges `from → to`, each tagged with a small number (which property). */
export class EdgeList {
  private from = new Uint32Array(1 << 16);
  private to = new Uint32Array(1 << 16);
  private tag = new Uint8Array(1 << 16);
  private length = 0;

  push(from: number, to: number, tag: number): void {
    if (this.length === this.from.length) this.grow();
    this.from[this.length] = from;
    this.to[this.length] = to;
    this.tag[this.length] = tag;
    this.length += 1;
  }

  get size(): number {
    return this.length;
  }

  forEach(visit: (from: number, to: number, tag: number) => void): void {
    for (let i = 0; i < this.length; i += 1) visit(this.from[i], this.to[i], this.tag[i]);
  }

  private grow(): void {
    const capacity = this.from.length * 2;
    const from = new Uint32Array(capacity);
    const to = new Uint32Array(capacity);
    const tag = new Uint8Array(capacity);
    from.set(this.from);
    to.set(this.to);
    tag.set(this.tag);
    this.from = from;
    this.to = to;
    this.tag = tag;
  }
}

/** A growing list of 32-bit numbers, handed over as a typed array: what a worker sends back. */
export class Numbers {
  private values = new Uint32Array(1024);
  private length = 0;

  push(value: number): void {
    if (this.length === this.values.length) {
      const grown = new Uint32Array(this.values.length * 2);
      grown.set(this.values);
      this.values = grown;
    }
    this.values[this.length] = value;
    this.length += 1;
  }

  take(): Uint32Array {
    return this.values.slice(0, this.length);
  }
}
