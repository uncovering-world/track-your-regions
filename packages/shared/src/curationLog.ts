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
  'merged',
  'merge_undone',
  'views_chosen',
  'component_items_answered',
  'component_item_taken_back',
  'admission_pin_released',
  'admission_pin_kept',
  'admission_pin_handed_back',
  'merge_proposal_answered',
  'visit_question_answered',
  'identifier_settled',
  'separated',
  'kept_out',
  'merge_proposal_taken_back',
  'kind_added',
  'find_site_answered',
  'crowding_answered',
  'part_added',
  'part_taken_out',
  'part_put_back',
  'part_replaced',
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

/**
 * The acts a curator takes against what the rule decided (#956): a place the
 * rule kept out put back, and a place the rule holds taken out of a kind. An
 * auditor reads a curator's trail for these first; the trail's count of them
 * and the mark on their rows read this one list.
 *
 * An arrival turned away (`arrival_refused`) is not among them: answering an
 * arrival is the gate's routine review, which the rule asked for, and the
 * trail counts it on a line of its own.
 */
export const AGAINST_THE_RULE_ACTIONS = [
  'admission_overridden',
  'kept_out',
] as const satisfies readonly CurationLogAction[];

/** The acts that change a fact by hand: the place's own fields, one of its points, one of its works. */
export const EDITED_BY_HAND_ACTIONS = [
  'edited',
  'location_edited',
  'work_edited',
] as const satisfies readonly CurationLogAction[];

/**
 * Why a curator acted (#863): the code a log entry keeps in
 * `details.reasonCode`, beside the curator's optional words in `details.note`.
 * The why is the half of a curator's act a rule is tuned from, so it is a
 * code a query can group by rather than free text; `other` keeps every
 * surface answerable.
 */
export const CURATION_REASON_CODES = [
  'not-this-kind',
  'not-worth-a-visit',
  'not-one-place',
  'wrong-place',
  'duplicate',
  'gone',
  'source-text',
  'missing-from-rule',
  'never-gone',
  'rebuilt',
  'other',
] as const;

/** One reason a curator may give for an act. */
export type CurationReasonCode = (typeof CURATION_REASON_CODES)[number];

/**
 * Each reason in a curator's words, as a line of the chooser offers it
 * (`ReasonMenu` in the web app): a few words read at a glance, since one click
 * on the line is the whole act.
 */
export const CURATION_REASON_WORDS = {
  'not-this-kind': 'Not this kind of place',
  'not-worth-a-visit': 'Nothing to see',
  'not-one-place': 'Not one place',
  'wrong-place': 'Wrong place',
  'duplicate': 'Same as another',
  'gone': 'Gone or not built',
  'source-text': 'Source wording unusable as written',
  'missing-from-rule': 'The rule missed it',
  'never-gone': 'It was never gone',
  'rebuilt': 'Rebuilt since',
  'other': 'Other',
} as const satisfies Record<CurationReasonCode, string>;

/**
 * The reasons a refusal offers: an arrival turned away, a place kept out of
 * a kind. Each surface offers only the reasons that fit its act.
 */
export const REFUSAL_REASON_CODES = [
  'not-this-kind',
  'not-worth-a-visit',
  'not-one-place',
  'gone',
  'duplicate',
  'wrong-place',
  'other',
] as const satisfies readonly CurationReasonCode[];

/**
 * The reasons a place rejected from a region, or taken out of one, offers.
 * A region act is about where a place stands, not what it is, so "not this
 * kind" and "not one place" are a kind's questions and are not offered here.
 */
export const REGION_REFUSAL_REASON_CODES = [
  'wrong-place',
  'not-worth-a-visit',
  'duplicate',
  'gone',
  'other',
] as const satisfies readonly CurationReasonCode[];

/**
 * The reasons an addition offers: a place put back into a kind, added to one
 * by hand, created by hand or placed in a region by hand.
 */
export const ADDITION_REASON_CODES = [
  'missing-from-rule',
  'other',
] as const satisfies readonly CurationReasonCode[];

/**
 * The reasons a place recorded as gone by hand offers (ADR-0217 decision 5):
 * the rule that reads a place as gone missed it.
 */
export const GONE_REASON_CODES = [
  'missing-from-rule',
  'other',
] as const satisfies readonly CurationReasonCode[];

/**
 * The reasons a place's *gone* taken back offers: it never went, and the
 * verdict misread it, or it was rebuilt, as Ponte Santa Trinita in Florence
 * was after 1944.
 */
export const STANDS_REASON_CODES = [
  'never-gone',
  'rebuilt',
  'other',
] as const satisfies readonly CurationReasonCode[];

/** The reasons an answer to a source's value offers: a value declined, or rewritten. */
export const SOURCE_ANSWER_REASON_CODES = [
  'source-text',
  'wrong-place',
  'other',
] as const satisfies readonly CurationReasonCode[];
