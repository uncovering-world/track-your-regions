/**
 * The lifecycle axes of the catalogue's rows, and the moves each may make
 * (#794, ADR-0070).
 *
 * Each vocabulary is declared in the order the schema's CHECK lists it, and
 * pinned to that CHECK by a type in `backend/src/db/curationLogActions.test.ts`.
 *
 * The two-valued axes move freely: a curator may call a place lost and take it
 * back, a rule may refuse a membership and a run restore it. `curation_state`
 * does not. Two of its moves would break the gate of ADR-0025 without anything
 * failing — `verified` → `pending` takes a published row off every reader's
 * screen, and `pending` → `auto` publishes one nobody has passed — so the moves
 * each table may make are listed below, and the database refuses the rest
 * (`guard_curation_state_move()`, `db/init/01-schema.sql`). A database-lane spec
 * walks every pair against this list, so the trigger and the list cannot come to
 * disagree.
 */

/** `experience_kind_memberships.admission`: whether a kind's rule accepts the place. */
export const ADMISSIONS = ['admitted', 'refused'] as const;
export type Admission = (typeof ADMISSIONS)[number];

/** `existence` on a place and on a point: whether it still stands. */
export const EXISTENCES = ['extant', 'lost'] as const;
export type Existence = (typeof EXISTENCES)[number];

/** `source_membership` on a place and on a point: whether its source still lists it. */
export const SOURCE_MEMBERSHIPS = ['present', 'former'] as const;
export type SourceMembership = (typeof SOURCE_MEMBERSHIPS)[number];

/**
 * `curation_state` on a membership, a point, a work and a work's link: has
 * anyone looked at it (ADR-0025). `pending` is a gated arrival nobody has
 * passed, hidden from readers; `auto` came from a trusted source and is shown;
 * `verified` is one a curator passed.
 */
export const CURATION_STATES = ['pending', 'auto', 'verified'] as const;
export type CurationState = (typeof CURATION_STATES)[number];

/** A move from one state to another; a row staying where it is is no move. */
export type CurationMove = readonly [from: CurationState, to: CurationState];

/**
 * The moves each table's `curation_state` may make, and what makes each one.
 *
 * - `pending` → `verified`: a curator publishes an arrival.
 * - `auto` → `verified`: a curator publishes a held proposal on a shown
 *   membership.
 * - `verified` → `auto`: a trusted source brings content nobody has passed, and
 *   the curator's pass on the place decays (`retirePassAfterNewContent`).
 * - `auto` → `pending`: a curator refuses a link whose work is unread; the link
 *   takes the state its refusal means (`refused_at`, ADR-0053).
 *
 * Every other move is refused, and a row is created in whatever state its
 * writer inserts it with: the gate is on the move, not on the insert.
 */
export const CURATION_MOVES = {
  experience_kind_memberships: [['pending', 'verified'], ['auto', 'verified'], ['verified', 'auto']],
  experience_locations: [['pending', 'verified']],
  treasures: [['pending', 'verified']],
  experience_treasures: [['pending', 'verified'], ['auto', 'pending']],
} as const satisfies Record<string, readonly CurationMove[]>;
export type CuratedTable = keyof typeof CURATION_MOVES;
