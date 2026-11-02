/**
 * The crowded cities' list on the review page's *Crowded cities* tab (#2282):
 * a group's name and address word, and its Region and Kind filters, each
 * counted the way the queue's chips are — what picking a value would leave,
 * under the other filter.
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
  kinds: string[];
}

export const NO_CROWD_FILTERS: CrowdFilters = { region: null, kinds: [] };

const regionWord = (group: ShadowedArrivalsGroup) => String(group.regionId ?? 'none');
const kindWord = (group: ShadowedArrivalsGroup) => String(group.kindId);

const inRegion = (filters: CrowdFilters) => (group: ShadowedArrivalsGroup) =>
  filters.region === null || regionWord(group) === filters.region;
const inKinds = (filters: CrowdFilters) => (group: ShadowedArrivalsGroup) =>
  filters.kinds.length === 0 || filters.kinds.includes(kindWord(group));

/** The groups both filters keep, in the server's order. */
export function filterGroups(groups: readonly ShadowedArrivalsGroup[], filters: CrowdFilters): ShadowedArrivalsGroup[] {
  return groups.filter(group => inRegion(filters)(group) && inKinds(filters)(group));
}

/** How many new places the groups hold. */
export function arrivalsIn(groups: readonly ShadowedArrivalsGroup[]): number {
  return groups.reduce((sum, group) => sum + group.arrivals, 0);
}

/**
 * Every value of one filter among `groups`, first seen first, each counting the
 * new places of the groups the other filter keeps: a value that leaves none is
 * listed at zero, which the chip dims, rather than dropped.
 */
function options(
  groups: readonly ShadowedArrivalsGroup[],
  word: (group: ShadowedArrivalsGroup) => string,
  label: (group: ShadowedArrivalsGroup) => string,
  checked: (key: string) => boolean,
  counted: (group: ShadowedArrivalsGroup) => boolean,
): FilterOption[] {
  const byKey = new Map<string, FilterOption & { count: number }>();
  for (const group of groups) {
    const key = word(group);
    const option = byKey.get(key) ?? { key, label: label(group), count: 0, checked: checked(key) };
    if (counted(group)) option.count += group.arrivals;
    byKey.set(key, option);
  }
  return [...byKey.values()];
}

/** The Region chip's rows, counted under the Kind filter; the most new places first. */
export function regionOptions(groups: readonly ShadowedArrivalsGroup[], filters: CrowdFilters): FilterOption[] {
  return options(groups, regionWord, group => group.regionName ?? 'No region', key => key === filters.region, inKinds(filters))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
}

/** The Kind chip's rows, counted under the Region filter, in the server's order of kinds. */
export function kindOptions(groups: readonly ShadowedArrivalsGroup[], filters: CrowdFilters): FilterOption[] {
  return options(groups, kindWord, group => group.kindName, key => filters.kinds.includes(key), inRegion(filters));
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
