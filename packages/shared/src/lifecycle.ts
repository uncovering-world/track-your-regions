/**
 * The lifecycle axes of the catalogue's rows, and the moves each may make
 * (#794, ADR-0070).
 *
 * Each vocabulary is declared in the order the schema's CHECK lists it, and
 * pinned to that CHECK by a type in `backend/src/db/curationLogActions.test.ts`.
 *
 * The two-valued axes move freely: a curator may call a point lost and take it
 * back, a rule may refuse a membership and a run restore it. Whether a place
 * still stands is not an axis of its row: it is read from its periods
 * (ADR-0217 decision 5, `place_periods`). `curation_state`
 * does not. Two of its moves would break the gate of ADR-0025 without anything
 * failing — `verified` → `pending` takes a published row off every reader's
 * screen, and `pending` → `auto` publishes one nobody has passed — so the moves
 * each table may make are listed below, and the database refuses the rest
 * (`guard_curation_state_move()`, `db/init/01-schema.sql`). A database-lane spec
 * walks every pair against this list, so the trigger and the list cannot come to
 * disagree.
 */

/** `source_records.admission`: whether a kind's rule accepts the place. */
export const ADMISSIONS = ['admitted', 'refused'] as const;

/**
 * The reason a curator's refusal of a membership carries, in the words the
 * kept-out list shows: the server writes it, and an arrival's card tells it
 * from a rule's reason by it (#2185). The schema's derivation of a part's
 * record gate writes the same words (`refresh_part_record_gates()`).
 */
export const CURATOR_REFUSAL_REASON = 'kept out by a curator';
export type Admission = (typeof ADMISSIONS)[number];

/**
 * `existence` on a point: whether it still stands. A place's is its periods
 * (ADR-0217 decision 5); a point's goes with the point tables (ADR-0225).
 */
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
  source_records: [['pending', 'verified'], ['auto', 'verified'], ['verified', 'auto']],
  experience_locations: [['pending', 'verified']],
  treasures: [['pending', 'verified']],
  experience_treasures: [['pending', 'verified'], ['auto', 'pending']],
} as const satisfies Record<string, readonly CurationMove[]>;
export type CuratedTable = keyof typeof CURATION_MOVES;
