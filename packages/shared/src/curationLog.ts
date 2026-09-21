/**
 * What a curator can be recorded as having done to an object — the vocabulary
 * of `experience_curation_log.action`.
 *
 * Declared here in the order the schema's CHECK lists them, and pinned to that
 * CHECK by a type: `backend/src/db/curationLogActions.test.ts` asks TypeScript
 * whether this union and the generated `CheckValue<'experience_curation_log',
 * 'action'>` are the same, so an action added to the schema and not here — or
 * here and not there — fails the typecheck rather than reaching a row. The
 * drawing side types its labels by the same union (`ACTION_LABELS` in
 * `frontend/src/components/shared/curationLog.ts`), so an act with no label,
 * or a label for an act that cannot happen, is a type error too. Until #789
 * that agreement was held by a test reading both files as text.
 */
export const CURATION_LOG_ACTIONS = [
  'created',
  'rejected',
  'unrejected',
  'edited',
  'added_to_region',
  'removed_from_region',
  'marked_former',
  'marked_lost',
  'state_restored',
  'accepted_source',
  'declined_source',
  'declined_held',
  'missing_dismissed',
  'admission_confirmed',
  'admission_overridden',
  'published',
  'location_marked_former',
  'location_marked_lost',
  'location_state_restored',
  'location_missing_dismissed',
  'location_edited',
  'work_edited',
  'arrival_refused',
  'contents_refused',
  'contents_unrefused',
] as const;

/** One act of the curation log. */
export type CurationLogAction = (typeof CURATION_LOG_ACTIONS)[number];

/**
 * The verdicts on one point (ADR-0026), the family the `location_` prefix keeps
 * apart from the same four verdicts on the whole object. Written by different
 * endpoints, answered on different cards, and read by the review queue's
 * contents and by the history's formatter alike.
 */
export const POINT_VERDICT_ACTIONS = [
  'location_marked_former',
  'location_marked_lost',
  'location_state_restored',
  'location_missing_dismissed',
] as const satisfies readonly CurationLogAction[];
