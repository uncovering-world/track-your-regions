/**
 * How an object's parts are browsed when there are many of them (#1271).
 *
 * Prehistoric Pile Dwellings around the Alps has 111 parts in six countries;
 * Rock Art of the Mediterranean Basin on the Iberian Peninsula has 758 in one.
 * A flat list of either is a list nobody reads, so the parts are grouped by
 * **the first level of their region path at which they part ways**: the
 * countries for the pile dwellings (Switzerland 56, Italy 19, Germany 18,
 * France 11, Austria 5, Slovenia 2), the autonomous communities for the rock
 * art (Comunidad Valenciana 299, Aragón 165, …), whatever the world view calls
 * its levels. A part placed in no region is a group of its own, listed last.
 * Each group says how many parts have a picture of their own.
 */

export interface GroupablePart {
  /** The leaf region the part lies in, with its ancestors: `Europe > Switzerland > Aargau`. */
  regionPath: string | null;
  /** The part has a picture of its own (#1270). */
  hasPicture?: boolean;
}

export interface PartGroup<T> {
  /** What the group is called: the region at the level the parts part ways, or the unplaced. */
  label: string;
  parts: T[];
  /** How many of them have a picture of their own. */
  withPicture: number;
}

/** What the group of parts placed in no region is called. */
export const UNPLACED_GROUP = 'Not placed in a region';

const levelsOf = (path: string | null): string[] => (path ?? '').split(' > ').map(s => s.trim()).filter(Boolean);

/**
 * The parts in groups, largest first and the unplaced last; the parts keep the
 * order they arrived in within their group. One group, or none, where the parts
 * never part ways.
 */
export function groupParts<T extends GroupablePart>(parts: readonly T[]): PartGroup<T>[] {
  const levels = parts.map(part => levelsOf(part.regionPath));
  const placed = levels.filter(path => path.length > 0);
  const deepest = Math.max(0, ...placed.map(path => path.length));
  // The first level at which two placed parts name different regions; where
  // none does, the deepest level they share names the one group.
  let depth = deepest - 1;
  for (let level = 0; level < deepest; level += 1) {
    if (new Set(placed.map(path => path[level] ?? path[path.length - 1])).size > 1) {
      depth = level;
      break;
    }
  }

  const byLabel = new Map<string, PartGroup<T>>();
  parts.forEach((part, index) => {
    const path = levels[index];
    const label = path.length === 0 ? UNPLACED_GROUP : (path[depth] ?? path[path.length - 1]);
    let group = byLabel.get(label);
    if (!group) {
      group = { label, parts: [], withPicture: 0 };
      byLabel.set(label, group);
    }
    group.parts.push(part);
    if (part.hasPicture) group.withPicture += 1;
  });

  return [...byLabel.values()].sort((a, b) => {
    if ((a.label === UNPLACED_GROUP) !== (b.label === UNPLACED_GROUP)) return a.label === UNPLACED_GROUP ? 1 : -1;
    return b.parts.length - a.parts.length || a.label.localeCompare(b.label);
  });
}

/**
 * The parts a search and the photo filter leave: a name or a reference holding
 * the folded search text, and a picture of the part's own where asked.
 */
export function filterParts<T extends { hasPicture?: boolean }>(
  parts: readonly T[],
  search: string,
  photoOnly: boolean,
  fold: (text: string) => string,
  textOf: (part: T) => string,
): T[] {
  const needle = fold(search.trim());
  return parts.filter(part => (!photoOnly || part.hasPicture === true)
    && (needle === '' || fold(textOf(part)).includes(needle)));
}
