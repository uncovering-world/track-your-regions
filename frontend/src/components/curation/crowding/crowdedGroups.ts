/**
 * The crowded cities' list on the review page's *Crowded cities* tab (#2282):
 * a group's name and address word, and its Region and Kind filters, each
 * counted the way the queue's chips are — what picking a value would leave,
 * under the other filter. The Region filter is the server's (#2349): the list
 * is read again within the region picked, and the Kind filter is kept here.
 */

import type { ShadowedArrivalsGroup } from '../../../api/crowding';
import { crowdKeyOf } from '../../../utils/appUrl';
import { typePluralWord } from '../../../utils/experienceTypes';
import type { FilterOption } from '../feed/FilterChip';
import type { Staging } from './crowdingStaging';

/** "Berlin · squares": the group's region and its type's plural, which the window steps through. */
export function groupName(group: ShadowedArrivalsGroup): string {
  return `${group.regionName ?? 'No region'} · ${typePluralWord(group.kindId, group.kindName, group.type).toLowerCase()}`;
}

/** The tab's two filters: a region (one at most, as the queue's region chip) and any number of kinds. */
export interface CrowdFilters {
  /** `crowdKeyOf`'s region word: an id, or `none`. */
  region: string | null;
  /**
   * The row of the region picked by the chip's search (#2349), which no group
   * may be listed under (Berlin, where the groups name its districts), so the
   * chip says it and its menu holds the row to clear it by. Null for a region
   * picked from the list.
   */
  searched: FilterOption | null;
  kinds: string[];
}

export const NO_CROWD_FILTERS: CrowdFilters = { region: null, searched: null, kinds: [] };

/**
 * The region the read is asked for (#2349): the server keeps the groups whose
 * region lies within it, as the queue's Region chip reads "within", so a city
 * or a country holds the groups of every region under it and a leaf its own.
 */
export function regionAsked(filters: CrowdFilters): number | 'none' | undefined {
  if (filters.region === null) return undefined;
  return filters.region === 'none' ? 'none' : Number(filters.region);
}

const regionWord = (group: ShadowedArrivalsGroup) => String(group.regionId ?? 'none');
const kindWord = (group: ShadowedArrivalsGroup) => String(group.kindId);

const inKinds = (filters: CrowdFilters) => (group: ShadowedArrivalsGroup) =>
  filters.kinds.length === 0 || filters.kinds.includes(kindWord(group));

/** The groups the Kind filter keeps of those read within the region, in the server's order. */
export function filterGroups(within: readonly ShadowedArrivalsGroup[], filters: CrowdFilters): ShadowedArrivalsGroup[] {
  return within.filter(inKinds(filters));
}

/**
 * Every group the tab has read, the whole list's first. A group read within a
 * region is one of the whole list's unless another world view groups it there,
 * and it is known by name all the same.
 */
export function everyGroup(
  all: readonly ShadowedArrivalsGroup[], within: readonly ShadowedArrivalsGroup[],
): ShadowedArrivalsGroup[] {
  const keys = new Set(all.map(crowdKeyOf));
  return [...all, ...within.filter(group => !keys.has(crowdKeyOf(group)))];
}

/** How many new places the groups hold. */
export function arrivalsIn(groups: readonly ShadowedArrivalsGroup[]): number {
  return groups.reduce((sum, group) => sum + group.arrivals, 0);
}

/**
 * Every value of one filter among `listed`, first seen first, each counting the
 * new places of the `counted` groups it names: a value that leaves none is
 * listed at zero, which the chip dims, rather than dropped.
 */
function options(
  listed: readonly ShadowedArrivalsGroup[],
  counted: readonly ShadowedArrivalsGroup[],
  word: (group: ShadowedArrivalsGroup) => string,
  label: (group: ShadowedArrivalsGroup) => string,
  checked: (key: string) => boolean,
): FilterOption[] {
  const byKey = new Map<string, FilterOption & { count: number }>();
  for (const group of listed) {
    const key = word(group);
    if (!byKey.has(key)) byKey.set(key, { key, label: label(group), count: 0, checked: checked(key) });
  }
  for (const group of counted) {
    const option = byKey.get(word(group));
    if (option) option.count += group.arrivals;
  }
  return [...byKey.values()];
}

/**
 * The Region chip's rows: the regions of the whole list, counted under the
 * Kind filter, the most new places first; and, above them, the region the
 * search picked where it is none of them (#2349), counting the new places
 * within it that the Kind filter keeps, once the read within it has answered.
 * A listed row counts only the arrivals the whole list groups under it, each
 * under the leaf of the first world view that places it, so where several
 * world views place one arrival, picking the row can show more than it counts.
 */
export function regionOptions(
  all: readonly ShadowedArrivalsGroup[], within: readonly ShadowedArrivalsGroup[] | undefined, filters: CrowdFilters,
): FilterOption[] {
  const label = (group: ShadowedArrivalsGroup) => group.regionName ?? 'No region';
  const rows = options(all, all.filter(inKinds(filters)), regionWord, label, key => key === filters.region)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  const { searched } = filters;
  if (!searched || rows.some(row => row.checked)) return rows;
  const count = within && arrivalsIn(filterGroups(within, filters));
  return [{ ...searched, count, checked: true }, ...rows];
}

/**
 * The Kind chip's rows: the kinds of the whole list, in the server's order,
 * counted within the region. None until the read within it has answered: a
 * chip that showed zeros meanwhile would claim a number nobody gave it.
 */
export function kindOptions(
  all: readonly ShadowedArrivalsGroup[], within: readonly ShadowedArrivalsGroup[] | undefined, filters: CrowdFilters,
): FilterOption[] {
  if (!within) return [];
  return options(all, within, kindWord, group => group.kindName, key => filters.kinds.includes(key));
}

/** The group the address names, where the filtered list still holds it; else the list's first, so the window is never empty. */
export function groupShown(groups: readonly ShadowedArrivalsGroup[], key: string | null): ShadowedArrivalsGroup | undefined {
  return groups.find(group => crowdKeyOf(group) === key) ?? groups[0];
}

/**
 * The answers staged on the tab, by group (`crowdKeyOf`): a window's Apply
 * sends its own group's only, and a group left keeps its answers for the
 * curator's return, so nothing staged in Berlin goes with Rome's Apply.
 */
export type GroupStagings = ReadonlyMap<string, Staging>;

const NOTHING_STAGED: Staging = new Map();

/** What is staged in one group. */
export function stagingIn(stagings: GroupStagings, key: string): Staging {
  return stagings.get(key) ?? NOTHING_STAGED;
}

/** The stagings with one group's replaced; a group with nothing staged is dropped. */
export function withStaging(stagings: GroupStagings, key: string, staging: Staging): GroupStagings {
  const next = new Map(stagings);
  if (staging.size > 0) next.set(key, staging);
  else next.delete(key);
  return next;
}

/** How many answers are staged across the groups. */
export function stagedCount(stagings: GroupStagings): number {
  return [...stagings.values()].reduce((sum, staging) => sum + staging.size, 0);
}

/** A group other than the one on screen that holds staged answers, named as its line is, or by none where the list no longer holds it. */
export interface StagedElsewhere {
  key: string;
  count: number;
  group: ShadowedArrivalsGroup | undefined;
}

/** The groups other than `shownKey` with answers staged, in the list's order, a group the list no longer holds last. */
export function stagedElsewhere(
  stagings: GroupStagings, groups: readonly ShadowedArrivalsGroup[], shownKey: string | null,
): StagedElsewhere[] {
  const byKey = new Map(groups.map(group => [crowdKeyOf(group), group]));
  return [...stagings]
    .filter(([key, staging]) => key !== shownKey && staging.size > 0)
    .map(([key, staging]) => ({ key, count: staging.size, group: byKey.get(key) }))
    .sort((a, b) => (a.group ? groups.indexOf(a.group) : groups.length) - (b.group ? groups.indexOf(b.group) : groups.length));
}
