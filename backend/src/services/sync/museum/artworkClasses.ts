/**
 * A full P279* (subclass-of, transitive) closure is safe for museums — 373 classes — but not
 * for artworks: sculpture (Q860861) reaches 143 106 classes and print (Q11060274) reaches
 * 20 738, because Wikidata models a banknote as a work printed from a plate and gives every
 * denomination its own class. So expand hop by hop and refuse a hop that multiplies the set.
 */
export interface ClosureOptions {
  maxHops?: number;
  maxGrowth?: number;
  growthFloor?: number;
  hardCap?: number;
}

export interface ClosureResult {
  classes: string[];
  refused: { root: string; hop: number; offered: number }[];
}

export async function boundedClosure(
  roots: string[],
  fetchChildren: (qids: string[]) => Promise<string[]>,
  opts: ClosureOptions = {},
): Promise<ClosureResult> {
  const maxHops = opts.maxHops ?? 3;
  const maxGrowth = opts.maxGrowth ?? 3;
  // Without a floor, hop 1 is compared against a set of size 1 and always loses.
  const growthFloor = opts.growthFloor ?? 300;
  const hardCap = opts.hardCap ?? 2000;

  const all = new Set<string>();
  const refused: ClosureResult['refused'] = [];

  for (const root of roots) {
    const seen = new Set<string>([root]);
    let frontier = [root];
    for (let hop = 1; hop <= maxHops; hop++) {
      const children = (await fetchChildren(frontier)).filter((q) => !seen.has(q));
      const found = [...new Set(children)];
      if (!found.length) break;
      if (found.length > Math.max(seen.size, growthFloor) * maxGrowth
          || seen.size + found.length > hardCap) {
        refused.push({ root, hop, offered: found.length });
        break;
      }
      for (const q of found) seen.add(q);
      frontier = found;
    }
    for (const q of seen) all.add(q);
  }
  return { classes: [...all], refused };
}
