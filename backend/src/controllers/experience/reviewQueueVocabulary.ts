/**
 * The review queue's words, as lists: the five classes a question belongs to,
 * the three sub-kinds a waiting row groups, the kind word each card carries, and
 * the three answers a batch gives.
 *
 * A module of its own, with no imports, because both the SQL that asks the
 * questions (`reviewQueueKeys.ts`, `reviewAnswerDispatch.ts`) and the schema that
 * declares the answer (`api/responses/reviewQueue.ts`, ADR-0066) read them, and a
 * schema may import only what opens no pool.
 */

/** The five classes of open question, in no order: `KIND_RANK` gives theirs. */
export const QUEUE_KINDS = ['conflict', 'waiting', 'withdrawn', 'refused', 'missing'] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

/** The gated sub-kinds a `waiting` question groups (ADR-0025). */
export const WAITING_SUBS = ['arrival', 'held', 'contents'] as const;
export type WaitingSub = (typeof WAITING_SUBS)[number];

/**
 * The word each card of the queue's answer carries in `kind`: the seven open
 * kinds, and the three answered lists a curator can take a verdict back from.
 */
export const QUEUE_ITEM_KINDS = [
  'missing', 'conflict', 'refused', 'kept-out', 'arrival', 'held', 'contents',
  'withdrawn', 'withdrawn-answered', 'contents-refused',
] as const;
export type QueueItemKind = (typeof QUEUE_ITEM_KINDS)[number];

/** The two answers every review row has, and the third two kinds have (#852). */
export const REVIEW_ANSWERS = ['accept', 'reject', 'lost'] as const;
export type ReviewAnswer = (typeof REVIEW_ANSWERS)[number];
