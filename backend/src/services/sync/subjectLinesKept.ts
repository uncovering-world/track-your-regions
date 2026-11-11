/**
 * A subject stands on one line of a place's card: whom it commemorates, or what
 * it depicts (#2421). A curator who claims one line decides who stands there,
 * so a run writing the other line leaves them out of it (#2436). Big Vishnu's
 * curator listed Vishnu under *Depicts*; a run reading Vishnu and Garuda as
 * commemorated writes *Commemorates: Garuda*. On a published place the change
 * is then held as any other; on an arrival waiting for a curator, which a run
 * writes directly, nothing would otherwise keep the two lines apart.
 */

import { commemoratesOf, depictsOf } from '@tyr/shared/commemorates';
import { claimedMetadataKeys } from './changeSet.js';

const OTHER = { commemorates: 'depicts', depicts: 'commemorates' } as const;

/** The items a stored line names, read as its own value. */
function itemsOf(key: keyof typeof OTHER, value: unknown): Set<string> {
  const read = key === 'commemorates' ? commemoratesOf(value) : depictsOf(value);
  return new Set(read?.subjects.map(subject => subject.item) ?? []);
}

/**
 * The run's record with each line it writes cleared of whoever a curator's
 * claimed other line lists, and dropped where that leaves it naming nobody, as
 * a run that reads nobody writes none. A line the curator claims is the run's
 * to leave alone in any case, so only an unclaimed line is touched.
 */
export function withSubjectsOnOneLine<T extends { metadata: Record<string, unknown> }>(
  written: T,
  stored: { curated_fields?: string[] | null; metadata?: unknown } | null,
): T {
  const storedMetadata = (stored?.metadata ?? null) as Record<string, unknown> | null;
  const claimed = new Set(claimedMetadataKeys(stored?.curated_fields ?? [], storedMetadata));
  let metadata = written.metadata;
  for (const key of ['commemorates', 'depicts'] as const) {
    const other = OTHER[key];
    const value = metadata[key] as { subjects?: { item: string }[] } | undefined;
    if (claimed.has(key) || !claimed.has(other) || !value?.subjects) continue;
    const elsewhere = itemsOf(other, storedMetadata?.[other]);
    const subjects = value.subjects.filter(subject => !elsewhere.has(subject.item));
    if (subjects.length === value.subjects.length) continue;
    metadata = subjects.length > 0
      ? { ...metadata, [key]: { ...value, subjects } }
      : Object.fromEntries(Object.entries(metadata).filter(([name]) => name !== key));
  }
  return metadata === written.metadata ? written : { ...written, metadata };
}
