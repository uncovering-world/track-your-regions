/**
 * A fact two kinds' runs both propose, asked once (#1599).
 *
 * A place in two kinds can be asked about by both (#1264), and each section
 * holds what its own run proposed. Most of what a run proposes is a fact of
 * the place or of one of its parts — the Louvre's website, the Apollo
 * Belvedere's year — which no kind owns (ADR-0084): the Art Museums and the
 * Archaeology runs both propose AD 120 for the same work, and the card asked
 * it twice, once under each kind.
 *
 * Such a fact is lifted out of the kind sections into one "This place"
 * section, answered under one kind that proposes it. One answer settles
 * every copy: the answer is recorded on the place by value
 * (`experience_held_decisions`, `heldDecisions.ts`), so the other kind's row
 * of the same value has been answered too, and its pointer is cleared once
 * nothing of its proposal is left open (`clearAnsweredHeldPointers`).
 *
 * Only an equal value is lifted. The decision matches the value exactly, so a
 * fact the runs propose differently stays in each kind's section, where each
 * is answered on its own, as before. The values are compared as the API
 * serialises them, which is the database's jsonb text, rather than through
 * `jsonEquals`, whose leniency (`''` beside `null`) the decision does not share.
 */

import { tidyLabel } from '@tyr/shared/labels';
import type { HeldPart, ProposedField, ReviewQueueItem } from '../../api/reviewQueue';
import type { GatedGroup } from './gatedGroup';

/**
 * The fields a run proposes for its own membership, not for the place: the
 * type within the kind is the membership's (ADR-0084, `membershipType` in
 * `publishHeldFields.ts`), so one kind's answer must not settle another's.
 */
const MEMBERSHIP_FIELDS: ReadonlySet<string> = new Set(['type']);

const valueOf = (value: unknown): string => JSON.stringify(value ?? null);

const fieldKey = (field: ProposedField): string | null =>
  MEMBERSHIP_FIELDS.has(field.field) ? null : `field\u0000${field.field}\u0000${valueOf(field.new)}`;

const partKey = (part: HeldPart, field: string, value: unknown): string =>
  // The part by the name the run saw, tidied, as the decision keys it (`heldPartMatchSql`).
  ['part', part.kind, valueOf(part.item.ref), valueOf(part.item.name === null ? null : tidyLabel(part.item.name)),
    field, valueOf(value)]
    .join('\u0000');

/** Every key one held proposal asks, each once. */
function keysOf(held: ReviewQueueItem): Set<string> {
  const keys = new Set<string>();
  for (const field of held.proposed ?? []) {
    const key = fieldKey(field);
    if (key !== null) keys.add(key);
  }
  for (const part of held.proposed_parts ?? []) {
    for (const field of part.fields) keys.add(partKey(part, field.field, field.new));
  }
  return keys;
}

/** A held proposal narrowed to the keys `keep` says yes to; the parts left with no field go. */
function narrowed(held: ReviewQueueItem, keep: (key: string | null) => boolean): ReviewQueueItem {
  return {
    ...held,
    proposed: (held.proposed ?? []).filter(field => keep(fieldKey(field))),
    proposed_parts: (held.proposed_parts ?? [])
      .map(part => ({ ...part, fields: part.fields.filter(field => keep(partKey(part, field.field, field.new))) }))
      .filter(part => part.fields.length > 0),
  };
}

const asksNothing = (held: ReviewQueueItem): boolean =>
  (held.proposed ?? []).length === 0 && (held.proposed_parts ?? []).length === 0;

/**
 * One place's sections with the facts two kinds propose alike lifted into a
 * "This place" section first, or the sections as they were where nothing is
 * shared.
 *
 * The section answers under one membership, which has to hold every fact it
 * lifts, so it answers under the kind that shares the most of them, the first
 * of those on a tie, and lifts what that kind shares with another. Mỹ Sơn's
 * World Heritage run proposes only its Wikipedia link, which the Places of
 * worship and the Archaeology runs propose too, beside the description and
 * the Wikidata id they share: the section answers under Places of worship,
 * and all three are asked once. A kind section left with nothing of its own
 * goes, unless an arrival or unread contents keep it.
 */
export function liftSharedFacts(sections: GatedGroup[]): GatedGroup[] {
  const holding = sections.filter((group): group is GatedGroup & { held: ReviewQueueItem } => group.held !== undefined);
  if (holding.length < 2) return sections;
  const keys = new Map(holding.map(group => [group, keysOf(group.held)]));
  const proposers = new Map<string, number>();
  for (const held of keys.values()) for (const key of held) proposers.set(key, (proposers.get(key) ?? 0) + 1);
  const sharedOf = (group: GatedGroup & { held: ReviewQueueItem }) =>
    [...keys.get(group)!].filter(key => (proposers.get(key) ?? 0) > 1);
  const first = holding.reduce((best, group) => (sharedOf(group).length > sharedOf(best).length ? group : best));
  const shared = new Set(sharedOf(first));
  if (shared.size === 0) return sections;

  const place: GatedGroup = {
    id: first.id,
    name: first.name,
    membershipId: first.membershipId,
    held: narrowed(first.held, key => key !== null && shared.has(key)),
    sharedBy: holding
      .filter(group => [...keys.get(group)!].some(key => shared.has(key)))
      .map(group => ({
        kindName: group.held.kind_name ?? '', runId: group.held.sync_log_id ?? null, membershipId: group.membershipId ?? null,
        // Whether the run proposes every fact the section lifts, or only some of them (Mỹ Sơn's World Heritage run).
        proposesAll: [...shared].every(key => keys.get(group)!.has(key)),
      })),
  };
  const rest = sections.flatMap((group): GatedGroup[] => {
    if (!group.held) return [group];
    const held = narrowed(group.held, key => key === null || !shared.has(key));
    if (!asksNothing(held)) return [{ ...group, held, narrowed: true }];
    return group.arrival || group.contents ? [{ ...group, held: undefined }] : [];
  });
  return [place, ...rest];
}
