/**
 * A candidate's national register code, read as a second key beside its name
 * and place (#1340).
 *
 * A heritage register numbers the place a component is, and its code often
 * says what kind of entry it is: Romania's LMI writes the group in the code —
 * `CJ-I-s-A-07208` is an archaeology entry (Castra Potaissa), `CJ-II-m-B-07533`
 * an architecture one (Bologa Castle, offered for a Roman fort beside it). The
 * finder keeps the code on the proposal for the card, and a candidate whose
 * group differs from the one most of its site's coded candidates carry sorts
 * below those that agree. Reading the code off the Wikidata item is a Wikidata
 * read, not a register's own connector.
 */

import type { ComponentMatch } from './componentItemMatching.js';

export interface RegisterCode {
  /** The Wikidata property that carries the code. */
  property: string;
  /** The register's short name, as the card shows it before the code. */
  register: string;
  /** The entry's group the code writes, where the register writes one. */
  group: (code: string) => string | null;
}

/** The registers whose codes the finder reads, in one list. */
export const REGISTER_CODES: readonly RegisterCode[] = [
  // County, group (I archaeology, II architecture, III public monuments, IV memorials), …
  { property: 'P1770', register: 'LMI', group: code => /^[A-Z]{1,2}-(IV|I{1,3})-/.exec(code)?.[1] ?? null },
  // Switzerland's KGS inventory number and Finland's RKY id carry no group in the code.
  { property: 'P381', register: 'KGS', group: () => null },
  { property: 'P4009', register: 'RKY', group: () => null },
];

/** A code as an item carries it: which register, and the code. */
export interface ItemCode { property: string; code: string }

/** The code the card shows, the register named first: "LMI CJ-I-s-A-07208". */
export function shownCode(code: ItemCode): string {
  const register = REGISTER_CODES.find(r => r.property === code.property);
  return register ? `${register.register} ${code.code}` : code.code;
}

/** The entry's group as a key across registers ("LMI:I"), or null where the register writes none. */
function groupOf(code: ItemCode): string | null {
  const register = REGISTER_CODES.find(r => r.property === code.property);
  const group = register?.group(code.code) ?? null;
  return register && group ? `${register.register}:${group}` : null;
}

/** The group most of one site's coded candidates carry, or null where none or a tie. */
function dominant(groups: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const group of groups) counts.set(group, (counts.get(group) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0 || (ranked.length > 1 && ranked[0][1] === ranked[1][1])) return null;
  return ranked[0][0];
}

/**
 * The matches with their register code and whether its group disagrees with
 * the one most of the site's coded candidates carry. A code without a group,
 * or a site whose candidates split evenly, disagrees with nothing.
 */
export function withRegisterCodes(
  matches: readonly ComponentMatch[],
  codesOf: ReadonlyMap<string, readonly ItemCode[]>,
  siteOf: (locationId: number) => number,
): ComponentMatch[] {
  const first = (item: string) => codesOf.get(item)?.[0] ?? null;
  const grouped = (item: string) => {
    const code = first(item);
    return code ? groupOf(code) : null;
  };
  const bySite = new Map<number, string[]>();
  for (const match of matches) {
    const group = grouped(match.item);
    const site = siteOf(match.locationId);
    if (group) bySite.set(site, [...(bySite.get(site) ?? []), group]);
  }
  return matches.map(match => {
    const code = first(match.item);
    const group = grouped(match.item);
    const usual = dominant(bySite.get(siteOf(match.locationId)) ?? []);
    return {
      ...match,
      registerCode: code ? shownCode(code) : null,
      registerDisagrees: group !== null && usual !== null && group !== usual,
    };
  });
}
