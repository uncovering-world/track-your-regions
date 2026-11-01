/**
 * Where a crowded city's tail sits in the region's list (ADR-0172, #2201): a
 * folded row at the end of each kind's group that leaves places out, "37
 * shadowed churches", which opens the kind's tail under it as a list of its
 * own — never mixed into the group's rows, and counted by none of them.
 *
 * Pure: the tail's state is `useRegionTail`'s, the rows are `flattenGroups`'.
 */

import type { Experience } from '../../api/experiences';
import type { CrowdedOutCount } from '../../hooks/useRegionTail';
import { tailLabel } from '../shared/tailNotice';
import type { KindGroup } from './kindRows';

/** One kind's tail, as the list draws it at the end of the kind's group. */
export interface TailSection {
  kindId: number;
  /** "37 shadowed churches", counted over the type the group is narrowed to. */
  label: string;
  open: boolean;
  /** The open tail's places of that type, best known first; undefined while they load, empty while folded. */
  places: Experience[] | undefined;
  /** The open tail could not be read. */
  failed: boolean;
}

/** A kind a group can be made for: its id, its name and where it sorts. */
export interface TailKind {
  id: number;
  name: string;
  priority: number;
}

/**
 * The groups with one added for each crowded kind they lack, so its tail has a
 * group to end: a kind the region's list holds no place of at all — a small
 * region beside a dense core (ADR-0172, Consequences) — and the kind of a
 * selected place only a tail holds, whose card must open somewhere. A kind the
 * list holds but the map's view has filtered away stays away, as its rows do.
 */
export function withTailGroups(
  groups: KindGroup[],
  counts: readonly CrowdedOutCount[],
  inRegion: ReadonlySet<string>,
  kinds: readonly TailKind[],
  card: Experience | null,
): KindGroup[] {
  const names = new Set(groups.map(group => group.kindName));
  const added: KindGroup[] = [];
  const add = (name: string, priority: number) => {
    if (names.has(name)) return;
    names.add(name);
    added.push({ kindName: name, kindPriority: priority, experiences: [] });
  };
  if (card) add(card.kind_name, card.kind_priority);
  for (const kind of kinds) {
    if (!inRegion.has(kind.name) && counts.some(entry => entry.kindId === kind.id)) add(kind.name, kind.priority);
  }
  if (added.length === 0) return groups;
  return [...groups, ...added].sort((a, b) => a.kindPriority - b.kindPriority);
}

/**
 * Each group's tail, by the group's name: the label counted over the type its
 * chips chose, and, while open, the tail's places of that type. The place
 * `keepId` names stays whatever its type, as in the group (`narrowGroups`), and
 * keeps its tail's row where the type leaves the tail nothing else.
 */
export function tailSections(opts: {
  groupNames: readonly string[];
  kindIdOf: ReadonlyMap<string, number>;
  counts: readonly CrowdedOutCount[];
  kindTypes: ReadonlyMap<string, string>;
  open: ReadonlySet<number>;
  places: ReadonlyMap<number, Experience[]>;
  /** The open kinds whose tail could not be read. */
  failed?: ReadonlySet<number>;
  keepId: number | null;
}): Map<string, TailSection> {
  const { groupNames, kindIdOf, counts, kindTypes, open, places, failed, keepId } = opts;
  const sections = new Map<string, TailSection>();
  for (const name of groupNames) {
    const kindId = kindIdOf.get(name);
    if (kindId === undefined) continue;
    const ofKind = counts.filter(entry => entry.kindId === kindId);
    const type = kindTypes.get(name);
    const ofType = type === undefined ? ofKind : ofKind.filter(entry => entry.type === type);
    const loaded = open.has(kindId) ? places.get(kindId) : [];
    const rows = loaded?.filter(exp => type === undefined || exp.type === type || exp.id === keepId);
    const label = tailLabel(kindId, name, ofType)
      ?? (rows?.some(exp => exp.id === keepId) ? tailLabel(kindId, name, ofKind) : null);
    if (label === null) continue;
    sections.set(name, { kindId, label, open: open.has(kindId), places: rows, failed: failed?.has(kindId) ?? false });
  }
  return sections;
}

/**
 * The groups the list opens by itself for a card (`expansionForSelection`),
 * with a place only a tail holds counted in its kind's group: the group opens
 * for it as for one of its own rows.
 */
export function withTailCard<G extends { kindName: string; experiences: Experience[] }>(
  groups: G[], card: Experience | null,
): G[] {
  if (card === null) return groups;
  return groups.map(group => (group.kindName === card.kind_name
    ? { ...group, experiences: [...group.experiences, card] }
    : group));
}
