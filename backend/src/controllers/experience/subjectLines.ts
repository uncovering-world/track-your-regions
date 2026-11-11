/**
 * A subject stands on one line of a place's card (#2421): whom it commemorates,
 * or what it depicts. A curator's edit is refused when it would break that
 * (`editExperience`); a run's held proposal, published, is reconciled here, so
 * publishing a run's *Commemorates* never names someone a curator put under
 * *Depicts*, and the other way round.
 */

import { onBothLines } from '@tyr/shared/commemorates';

const LINES = ['metadata.commemorates', 'metadata.depicts'] as const;

/**
 * The metadata a publication writes with each line it publishes cleared of the
 * subjects the other line lists, where it publishes one line and not the other:
 * the line it leaves is the place's, a curator's claimed list among them. A
 * published line left naming nobody is dropped, as a run that reads nobody
 * writes none.
 */
export function keepSubjectsOnOneLine(
  metadata: Record<string, unknown>, published: readonly string[],
): Record<string, unknown> {
  const doubled = new Set(onBothLines(metadata.commemorates, metadata.depicts));
  const lines = LINES.filter(line => published.includes(line));
  if (doubled.size === 0 || lines.length !== 1) return metadata;
  const key = lines[0].slice('metadata.'.length);
  const value = metadata[key] as { subjects: { item: string }[] };
  const subjects = value.subjects.filter(subject => !doubled.has(subject.item));
  if (subjects.length > 0) return { ...metadata, [key]: { ...value, subjects } };
  return Object.fromEntries(Object.entries(metadata).filter(([name]) => name !== key));
}
