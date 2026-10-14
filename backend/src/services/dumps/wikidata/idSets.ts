/**
 * Sets and lists of Wikidata item numbers sized for the whole dump: about 140
 * million ids, which a bit each holds in under 20 MB, where a `Set<number>`
 * of the same ids would need gigabytes. They grow as larger ids arrive.
 */

export class IdSet {
  private bits = new Uint8Array(1 << 20);
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
