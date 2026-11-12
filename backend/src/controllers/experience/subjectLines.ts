/**
 * A subject stands on one line of a place's card (#2421): whom it commemorates,
 * or what it depicts. A curator's edit is refused when it would break that
 * (`editExperience`); a run's held proposal, published, is reconciled here, so
 * publishing a run's *Commemorates* never names someone a curator put under
 * *Depicts*, and the other way round.
 */

import { onBothLines } from '@tyr/shared/commemorates';

export const SUBJECT_LINES = ['metadata.commemorates', 'metadata.depicts'] as const;

export type SubjectLine = (typeof SUBJECT_LINES)[number];

/**
 * The other line as the same proposal will leave it (#2476): its proposed
 * value, where its change is still open and this call does not publish it.
 */
export type OpenLines = Partial<Record<SubjectLine, unknown>>;

/**
 * The metadata a publication writes with each line it publishes cleared of the
 * subjects the other line lists, where it publishes one line and not the other:
 * the line it leaves is the place's, a curator's claimed list among them. Where
 * the same proposal still holds an open, unclaimed change of that other line
 * (`open`), the line is read as that change proposes it, so publishing the two
 * one at a time leaves what publishing them together does (#2476). A published
 * line left naming nobody is dropped, as a run that reads nobody writes none.
 */
export function keepSubjectsOnOneLine(
  metadata: Record<string, unknown>, published: readonly string[], open: OpenLines = {},
): Record<string, unknown> {
  const lines = SUBJECT_LINES.filter(line => published.includes(line));
  if (lines.length !== 1) return metadata;
  const [line] = lines;
  const other = line === 'metadata.commemorates' ? 'metadata.depicts' : 'metadata.commemorates';
  const otherValue = other in open ? open[other] : metadata[other.slice('metadata.'.length)];
  const doubled = new Set(line === 'metadata.commemorates'
    ? onBothLines(metadata.commemorates, otherValue)
    : onBothLines(otherValue, metadata.depicts));
  if (doubled.size === 0) return metadata;
  const key = line.slice('metadata.'.length);
  const value = metadata[key] as { subjects: { item: string }[] };
  const subjects = value.subjects.filter(subject => !doubled.has(subject.item));
  if (subjects.length > 0) return { ...metadata, [key]: { ...value, subjects } };
  return Object.fromEntries(Object.entries(metadata).filter(([name]) => name !== key));
}
