import type { DashboardUnit } from '../../../api/admin/wvImportWorkflow';

export type GroupKind = 'continent' | 'custom';

export interface SupraGroup {
  id: string;
  name: string;
  kind: GroupKind;
}

export interface GroupingState {
  groups: SupraGroup[];
  /** regionId -> the groupIds it belongs to (overlapping membership). */
  membership: Record<number, string[]>;
}

/** One part of a transcontinental country's territory, landed in an L1 group. */
export interface TranscontinentalPart {
  groupId: string;
  label: string;
  note?: string;
}

export interface Transcontinental {
  regionId: number;
  name: string;
  parts: TranscontinentalPart[];
}

/** A renderable member row of a group (transcontinental parts substitute the label). */
export interface GroupMemberView {
  regionId: number;
  name: string;
  transcontinental: boolean;
  note?: string;
  overlapping: boolean;
}

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-/, '').replace(/-$/, '');

const continentOf = (u: DashboardUnit): string =>
  u.continent ?? (u.ancestorPath[0] ?? 'Ungrouped');

const contId = (name: string): string => `cont:${slug(name)}`;

/** One `continent` group per distinct continent; each country joins its own continent. */
export function buildInitialGroups(units: DashboardUnit[]): GroupingState {
  const continents = [...new Set(units.map(continentOf))].sort();
  const groups: SupraGroup[] = continents.map((c) => ({ id: contId(c), name: c, kind: 'continent' }));
  const membership: Record<number, string[]> = {};
  for (const u of units) membership[u.regionId] = [contId(continentOf(u))];
  return { groups, membership };
}

export function createCustomGroup(state: GroupingState, name: string): GroupingState {
  const s = slug(name);
  const id = `custom:${s}`;
  if (!s || state.groups.some((g) => g.id === id)) return state;
  return { ...state, groups: [...state.groups, { id, name: name.trim(), kind: 'custom' }] };
}

/** Add a membership (overlapping: never removes the country from its other groups). */
export function assignToGroup(state: GroupingState, regionId: number, groupId: string): GroupingState {
  const cur = state.membership[regionId] ?? [];
  if (cur.includes(groupId)) return state;
  return { ...state, membership: { ...state.membership, [regionId]: [...cur, groupId] } };
}

export function removeFromGroup(state: GroupingState, regionId: number, groupId: string): GroupingState {
  const cur = state.membership[regionId] ?? [];
  if (!cur.includes(groupId)) return state;
  return { ...state, membership: { ...state.membership, [regionId]: cur.filter((g) => g !== groupId) } };
}

export function groupMemberIds(state: GroupingState, groupId: string): number[] {
  return Object.entries(state.membership)
    .filter(([, gs]) => gs.includes(groupId))
    .map(([id]) => Number(id));
}

/** Countries belonging to more than one group. */
export function overlappingRegionIds(state: GroupingState): number[] {
  return Object.entries(state.membership)
    .filter(([, gs]) => gs.length > 1)
    .map(([id]) => Number(id));
}

// POC showcase: transcontinental countries — one pivot, territory split across L1 by continent,
// cut on a recognizable admin boundary (Russia: Ural FD to the Asian side).
const TRANSCONTINENTAL_DEFS: Record<string, Array<{ continent: string; label: string; note?: string }>> = {
  Russia: [
    { continent: 'Europe', label: 'European Russia' },
    { continent: 'Asia', label: 'Asian Russia', note: 'Ural FD → Asia' },
  ],
};

/** Resolve transcontinental countries present in `units` against the current continent groups. */
export function transcontinentalSplits(units: DashboardUnit[], state: GroupingState): Transcontinental[] {
  const byName = new Map(units.map((u) => [u.name, u]));
  const out: Transcontinental[] = [];
  for (const [name, defs] of Object.entries(TRANSCONTINENTAL_DEFS)) {
    const u = byName.get(name);
    if (!u) continue;
    const parts: TranscontinentalPart[] = [];
    for (const d of defs) {
      const g = state.groups.find((gr) => gr.kind === 'continent' && gr.name === d.continent);
      if (g) parts.push({ groupId: g.id, label: d.label, note: d.note });
    }
    if (parts.length) out.push({ regionId: u.regionId, name, parts });
  }
  return out;
}

/**
 * Members of a group as display rows. Regular members show their country name; a
 * transcontinental country attached to this group shows its part label (+ note) instead,
 * so the same pivot appears in each of its super-regions as a labelled part.
 */
export function groupMembersView(
  units: DashboardUnit[],
  state: GroupingState,
  groupId: string,
): GroupMemberView[] {
  const nameOf = new Map(units.map((u) => [u.regionId, u.name]));
  const overlapping = new Set(overlappingRegionIds(state));
  const partHere = new Map<number, TranscontinentalPart>();
  for (const t of transcontinentalSplits(units, state)) {
    const p = t.parts.find((pp) => pp.groupId === groupId);
    if (p) partHere.set(t.regionId, p);
  }
  const ids = new Set<number>([...groupMemberIds(state, groupId), ...partHere.keys()]);
  const rows: GroupMemberView[] = [];
  for (const regionId of ids) {
    const part = partHere.get(regionId);
    rows.push({
      regionId,
      name: part ? part.label : (nameOf.get(regionId) ?? String(regionId)),
      transcontinental: !!part,
      note: part?.note,
      overlapping: overlapping.has(regionId),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
