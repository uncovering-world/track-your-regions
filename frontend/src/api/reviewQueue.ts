/**
 * Review queue API client
 *
 * The curator's review queue (ADR-0051): the page of open questions and the
 * shapes of its rows, a run's batch set aside and brought back, and a page of
 * rows answered at once (#852) — every endpoint under
 * `/api/experiences/review/`.
 */

import { API_URL, authFetchJson } from './fetchUtils';
import type { ImageCredit } from './experiences';
import type { ReviewAddress } from '../utils/appUrl';

/**
 * One part of an object whose field a gated run held (ADR-0037), as the held
 * card carries it: the part as the run's record names it, the held fields, and
 * whatever the stored row can add so the part can be opened and told from its
 * siblings. The row's fields are null where no offered row answers to the record.
 */
export interface HeldPart {
  kind: 'locations' | 'treasures';
  /** The part as the *record* names it — the name as the run saw it, never rewritten (ADR-0026 decision 4). */
  item: { name: string | null; ref: string | null };
  /**
   * The stored row's name now, where the row was found. The record's name is a
   * snapshot, so a part corrected since — from this card's own dialog — would
   * otherwise be headed and seeded with the name it no longer has (#731).
   */
  storedName?: string | null;
  fields: Array<{ field: string; old: unknown; new: unknown; held?: boolean }>;
  locationId?: number | null;
  /** The fields a curator has claimed on the stored place, where the server sends them. */
  curatedFields?: string[] | null;
  latitude?: number | null;
  longitude?: number | null;
  ordinal?: number | null;
  treasureId?: number | null;
  artists?: string[] | null;
  artistsCurated?: boolean | null;
  /**
   * The fields a curator has claimed on the stored *work*.
   *
   * Its own name rather than sharing the place's above: both parts are built by
   * one `jsonb_build_object`, so one key could not answer for two rows — and a
   * held work part carries no place, nor the reverse.
   */
  workCuratedFields?: string[] | null;
  /** How many museums hang the work, for the reach the correction dialog states. */
  venueCount?: number | null;
  year?: number | null;
  imageUrl?: string | null;
  imageCredit?: ImageCredit | null;
  treasureType?: string | null;
}

/**
 * An experience waiting on a curator's decision.
 *
 * `missing` means a run stopped finding it at the source; `conflict` means the
 * source wants a field the curator has claimed. Until someone answers, users
 * see the experience exactly as before.
 */
export interface ReviewQueueItem {
  id: number;
  external_id: string;
  name: string;
  kind_id: number;
  kind_name: string;
  /**
   * The lifecycle axes, on **every** kind rather than only the two whose cards
   * are about them. Required here and therefore selected by every one of the queries
   * (`lifecycleSelectSql`), because the alternative — required in the type and absent
   * from the kinds whose cards are not about it — is the trap that reads as a working
   * comparison:
   * `item.existence === 'lost'` on an arrival card typechecks, compares against
   * `undefined`, and silently never fires.
   */
  missing_since: string | null;
  source_membership: 'present' | 'former';
  existence: 'extant' | 'lost';
  kind: 'missing' | 'conflict' | 'refused' | 'kept-out' | 'arrival' | 'held' | 'contents'
    | 'withdrawn' | 'withdrawn-answered' | 'contents-refused';
  /**
   * What the object is, carried on every kind for the same reason the lifecycle axes
   * are: one fragment feeds every one of the queries, so a card cannot show less about an
   * object than its neighbour. Every one of them is genuinely optional in the data —
   * 14 of 1604 rows have no image, and a landmark commonly has no website — so the
   * card renders what exists rather than reserving space for what does not.
   */
  image_url?: string | null;
  /** Whose photograph the card is showing — a curator's screen owes it too. */
  image_credit?: ImageCredit | null;
  latitude?: number | null;
  longitude?: number | null;
  website_url?: string | null;
  wikipedia_url?: string | null;
  region_names?: string[] | null;
  /**
   * The run's own question about a row it could not settle by its rule
   * (ADR-0058) — an art museum with an antiquities department, where whether
   * the exposition is substantially archaeology is nobody's class to answer.
   * On the card because that is where the answer is given, and where a batch
   * can dispose of the row without the object ever being opened (#852). Null
   * on every row no run asked anything about, which is nearly all of them.
   */
  admission_note?: string | null;
  /**
   * The danger listing as the reader-facing reads carry it, so a card about
   * `inDanger` can say "listed since 2003" rather than reading as this year's
   * news. Through `withDangerFields` on every kind, like the rest of the object.
   */
  in_danger?: boolean;
  danger_since?: number | null;
  /** Why this kind turned the row down, in the rule's own words. Refused items only. */
  admission_reason?: string | null;
  /** When a curator answered. Kept-out items only. */
  state_decided_at?: string | null;
  /** What the curator wrote when they answered. Kept-out items only. */
  state_note?: string | null;
  /**
   * `acceptable` false means accepting releases the claim and the next run
   * writes it — a `conflict` field only. A `held` field carries `held: true`
   * instead and no `acceptable`: nobody claimed it, the kind's gate kept it
   * out, and publishing is the only thing that can apply it (ADR-0025).
   *
   * `null` on every kind that carries no proposal, never absent: each of those
   * queries selects `NULL::jsonb AS proposed` explicitly, for the same reason
   * the three lifecycle fields above are selected everywhere. `Array<…> | null`
   * tells the next author that `item.proposed === null` is the whole check
   * before `.length`, and that is only true while every query answers with the
   * column.
   */
  proposed: Array<{
    field: string;
    old: unknown;
    new: unknown;
    acceptable?: boolean;
    held?: boolean;
    /**
     * Who claimed this field and when — absent where the claim predates the log, or
     * where the field is held by the gate rather than by a person. The card says "a
     * curator" for a claimant with no display name, because someone still decided.
     */
    claim?: { by: string; at: string } | null;
    /**
     * Every earlier answer on this same field, newest first — refusals as well as
     * acceptances, since a refusal shown as an acceptance is its own opposite.
     */
    decidedBefore?: Array<{
      by: string;
      at: string;
      /** Which answer it was. Absent on rows written before refusing was possible. */
      action?: 'accepted_source' | 'declined_source';
      /** What that answer was about: the value taken, or the one refused. */
      applied: unknown;
    }>;
  }> | null;
  /** When the run whose proposal this is finished. Conflicts only. */
  run_completed_at?: string | null;
  /**
   * The held fields of the object's *parts* — a place renamed, a work
   * re-attributed — under a gated source (ADR-0037). `held` items only, beside
   * `proposed`, which is the object's own; either may be null on a card about
   * the other, never both. Each carries the part as the run's record names it,
   * the held fields alone, and the stored row behind the record so the card can
   * open it — a coordinate and an ordinal for a place, the maker, the year and
   * the picture for a work. The row's fields are null where the record names a
   * part no offered row answers to any more: the proposal stands, with nothing
   * to open.
   */
  proposed_parts?: HeldPart[] | null;
  /**
   * The famous works the kind's rule weighed, most widely known first, capped at twelve.
   *
   * Refusals only, and only because the refusal text talks about them: "0 of 5 famous
   * works are paintings" asks *which five*, and the answer is already in the catalogue —
   * a run imports a venue's works before deciding about the venue.
   */
  counted_works?: Array<{
    name: string;
    type: string | null;
    artists: string[];
    artistsCurated: boolean;
    imageUrl: string | null;
    /** Whose photograph of the work it is — `countedWorksSelectSql` sends it beside the URL. */
    imageCredit?: ImageCredit | null;
    year: number | null;
    /**
     * The source's own id for the work — a Wikidata QID for everything stored today.
     *
     * Sent so the preview is not a dead end: a curator who does not recognise a work needs
     * somewhere to go, and this is where it came from. Not nullable: `treasures.external_id`
     * is `NOT NULL UNIQUE` — the identity the works upsert conflicts on — and this field is
     * built straight off that column.
     */
    externalId: string;
  }> | null;
  /**
   * How many works the object holds — on **every** kind, beside `offered_locations`,
   * because the pair is what the object is made of.
   *
   * It began as a refusal's own arithmetic and outgrew it: a refusal that cites a
   * number is reconciled against that number, one that names a single work cites none,
   * and without this the preview cannot tell a holding of twelve from the first twelve
   * of thirty. The *named* array beside it is still refusals only — UNESCO sites hold
   * no works, and every kind that holds none would carry a join for an empty list.
   */
  counted_works_total?: number | null;
  /**
   * The run this card is about. For a `conflict` or a `held` proposal it is
   * sent back so a newer run cannot substitute itself. For an `arrival` it is
   * the run that first saw the row and is **not** a pointer to anything held —
   * sending it as `expectedSyncLogId` would 409 every time, because a row
   * nobody can see holds no proposal.
   */
  sync_log_id?: number;
  /**
   * Unread points under a row readers already see. `contents` items only.
   *
   * A number because the query casts it. `COUNT(*)` is `bigint`, which `pg`
   * hands over as a string, and an uncast count arrives here as `"12"` — which
   * survives arithmetic by coercion and breaks a plural rule, since `'1' === 1`
   * is false. The cast is pinned by a test in `reviewQueueController.test.ts`.
   */
  pending_locations?: number;
  /** Unread works under a row readers already see. `contents` items only. */
  pending_treasures?: number;
  /**
   * The unread points themselves, in the source's own order. `contents` items only.
   *
   * At most the first `CONTENTS_ROWS_SHOWN` of `pending_locations`, which stays the
   * whole number — the catalogue's largest serial nomination holds 758 points, and a
   * card is not a place to answer 758 questions. So a list shorter than the count is
   * a cap and the card says so, rather than a list that quietly stands for the rest.
   */
  pending_points?: Array<{
    id: number;
    name: string | null;
    externalRef: string | null;
    latitude: number | null;
    longitude: number | null;
    /** The fields a curator has claimed on the row, where the server sends them. */
    curatedFields?: string[];
  }>;
  /**
   * The unread works, most famous first. `contents` items only, capped like the
   * points above.
   *
   * Ordered by sitelinks rather than by name or arrival, because that is the order a
   * curator judges in: a museum that gained the Venus de Milo and eleven studies has
   * one row worth reading first.
   */
  pending_works?: Array<{
    id: number;
    name: string | null;
    artists: string[];
    artistsCurated: boolean;
    year: number | null;
    imageUrl: string | null;
    iconic: boolean;
    /**
     * The work's own Wikidata id, where the row opens the item and its article
     * from (#806). Optional because an older server sends the row without it,
     * and a row without a link is the shape it had until then.
     */
    externalId?: string;
    /** What it is, for the dialog the row opens: "painting", "woodblock print". */
    treasureType?: string | null;
    /** Whose photograph the row's picture is, shown wherever that picture is (ADR-0043). */
    imageCredit?: ImageCredit | null;
    /** What a curator has already claimed on the work, so the row can say so (#731). */
    curatedFields?: string[] | null;
    /** How many museums hang it, for the reach a correction from this row would have. */
    venueCount?: number | null;
  }>;
  /** Whether anyone has passed the row. `arrival` items only, where it is `pending`. */
  curation_state?: string;
  /**
   * How many points the object still offers — on **every** kind, like the lifecycle
   * axes and the object context above, and for the same reason: it is part of what
   * the object *is*.
   *
   * The denominator a departure needs, and equally the thing a text diff needs: "a
   * part is gone" reads one way at one of seven and another at the only one there
   * was, and a proposed description of one estate of seven is unreadable against the
   * whole site's without it. Optional in the type only because a queue response
   * predating this field would not carry it. Cast server-side, for the reason given
   * on `pending_locations`.
   */
  offered_locations?: number;
  /**
   * The points this object lost, each waiting on its own verdict. `withdrawn` items only.
   *
   * The verdict goes to `POST /api/experiences/locations/:id/state`, so the id is what
   * the card needs; the name and the reference are how it says *which* point, and most
   * UNESCO components carry a reference and no name of their own.
   */
  withdrawn_points?: Array<{
    id: number;
    name: string | null;
    externalRef: string | null;
    missingSince: string;
    latitude: number | null;
    longitude: number | null;
    /**
     * Whether anyone had been there. The visit survives either answer (ADR-0022) and
     * the point it hangs on stops being shown, which is what makes the verdict matter
     * rather than tidy-up.
     */
    visited: boolean;
    /**
     * How far away the source now offers this same part, in metres — `null` where it
     * offers it nowhere.
     *
     * Identity is the point together with the source's reference, so a coordinate
     * rewritten more than ten metres away arrives as a withdrawal plus an arrival, and
     * within that the writer reads it as the same place and raises no *new* card
     * (ADR-0027). Short distances still arrive here, though, by more than one route — the
     * backend comment above the subquery that fills this field enumerates them, and it is
     * worth reading which rather than assuming one, the count having moved twice as the
     * writer changed. `db/migrations/026` leaves a pair standing
     * where the marked row carries a visit or a region assignment; a database may not have
     * had 026 applied at all, which `npm run db:migrate:status` now answers (ADR-0041)
     * without making it any less possible; and the pairing is
     * greedy, so it can mark a row while inserting one for the ordinal it lost, both within
     * ten metres of the same incoming point (decision 5a-i, #549). The last is a *new* card
     * rather than an inherited one. So anything up to ten metres can reach this field, which
     * is the band `withdrawalStory` answers with "the same place written more
     * precisely". A distance rather than a
     * flag because the flag could not be decided with: Bilbao's replacement is 1.2 cm
     * away — this field carries it as `0.01`, the query rounding to two decimals — the
     * stored latitude having been rounded before a later run wrote the source's full
     * value, and two coordinates rounded to four decimals showed the same numbers twice.
     */
    replacedMetres: number | null;
    /** The fields a curator has claimed on the row, where the server sends them. */
    curatedFields?: string[];
  }> | null;
  /**
   * The points this object lost that a curator has *answered*, and which no reader can
   * see as a result. `withdrawn-answered` items only.
   *
   * The same rows one verdict later, and the reason they need their own list is that the
   * verdict is what removed them from the one above: the queue asks about a flagged point
   * whose axes are still clean, and answering either axis takes the row out of it. No
   * other surface shows them — a point is not reachable at its own address, and every
   * reader-facing read hides one that is withdrawn or declared gone — so this list is
   * where a mis-click is taken back (#544).
   *
   * Both axes travel with each point because the card offers a way back from each one
   * separately, and because they are what the endpoint's `expected` is built from: a card
   * drawn before someone else answered collides rather than overwrites.
   *
   * No `replacedMetres` here, though the open card carries it: that field tells a
   * rewritten coordinate from a component that really moved, which is the question this
   * list is not re-asking.
   *
   * At most the first `CONTENTS_ROWS_SHOWN` of `answered_points_total`, newest answer
   * first. Capped where `withdrawn_points` is not, because this list only ever grows: a
   * point enters when it is answered and leaves only if the verdict is taken back.
   */
  answered_points?: Array<{
    id: number;
    name: string | null;
    externalRef: string | null;
    /** `null` where a later run found the point again and cleared the flag. */
    missingSince: string | null;
    latitude: number | null;
    longitude: number | null;
    sourceMembership: 'present' | 'former';
    existence: 'extant' | 'lost';
    /** When the standing answer was recorded. */
    decidedAt: string | null;
    /** What the curator wrote with it, if anything. */
    note: string | null;
    /**
     * Who last decided, read from the curation log under the log's own scope — `null`
     * where the act belongs to a region this reader does not cover, or predates the log.
     * The card says "a curator" then, because someone still decided.
     */
    decidedBy: string | null;
    /** Whether anyone had been there. The visit survives either answer (ADR-0022). */
    visited: boolean;
    /** The fields a curator has claimed on the row, where the server sends them. */
    curatedFields?: string[];
  }> | null;
  /**
   * How many answered points the object holds in all. `withdrawn-answered` items only.
   *
   * The whole number, beside a list that is the first `CONTENTS_ROWS_SHOWN` of it — the
   * pair `contents` carries, for the reason it carries it: a list without its total is a
   * silent cap, and this list is the one that only ever grows.
   */
  answered_points_total?: number;
  /**
   * The points a curator turned down, newest refusal first. `contents-refused`
   * items only, capped like every other per-row list here.
   *
   * `refusedBy` is read from the curation log under the log's own scope, the way
   * an answered withdrawal's is — `null` where the act belongs to a region this
   * reader does not cover, and the card says "a curator" then. `note` comes from
   * the same log row, so a batch refusal that named no reason carries none.
   */
  refused_points?: Array<{
    id: number;
    name: string | null;
    externalRef: string | null;
    latitude: number | null;
    longitude: number | null;
    curatedFields?: string[];
    refusedAt: string | null;
    refusedBy: string | null;
    note: string | null;
    /**
     * Set where the source has stopped listing the point since it was turned down.
     * Taking it back then restores the question without restoring the offer, and
     * the row says so — a refused point raises no withdrawn card of its own,
     * since that card asks for a state a refused point never has.
     */
    missingSince: string | null;
    /** Whether anyone had been there. A visit survives a refusal (ADR-0022). */
    visited: boolean;
  }> | null;
  /** How many turned-down points the object holds in all, beside a list that is its first `CONTENTS_ROWS_SHOWN`. */
  refused_points_total?: number;
  /**
   * The work links a curator turned down, newest refusal first — the work's own
   * fields, since that is what a curator recognises, under the treasure id the
   * take-back takes. `contents-refused` items only.
   */
  refused_works?: Array<{
    id: number;
    name: string | null;
    artists: string[];
    artistsCurated: boolean;
    year: number | null;
    externalId?: string;
    curatedFields?: string[] | null;
    refusedAt: string | null;
    refusedBy: string | null;
    note: string | null;
    /** The link's own withdrawal, for the reason the points above carry it. */
    missingSince: string | null;
  }> | null;
  /** How many turned-down work links the object holds in all. */
  refused_works_total?: number;
  /**
   * Whether the take-back would be accepted at all. `contents-refused` items only.
   *
   * Decided by the writer's own fragment (`contentsAnswerableSql`) rather than by a
   * second spelling of it on this side: an object nobody has passed, one a rule
   * kept out, or one the source has dropped refuses the take-back outright, and a
   * card offering a button that 409s is a dead end with nothing on it to act on.
   */
  takeable?: boolean;
  /** The membership's admission, for the sentence that names the question to answer first. */
  object_admission?: string | null;
  /** Its gate state, for the same sentence. Never the verdict — `takeable` is. */
  object_curation_state?: string | null;
}

/**
 * One open question, as the keys phase orders it (ADR-0051) — the page the
 * client actually draws. The seven arrays below are a lookup by id beside it,
 * not an order of their own. Mirrors the backend's `QueueKey`
 * (`reviewQueueKeys.ts`) minus `sourceId`, which the controller drops before
 * building `order`.
 */
export interface QueueOrderEntry {
  kind: 'conflict' | 'waiting' | 'withdrawn' | 'refused' | 'missing';
  id: number;
  /** When the run that raised this question completed; `null` for one still in flight. */
  askedAt: string | null;
  runId: number | null;
  /**
   * The gated sub-kinds a `waiting` row groups (ADR-0025): `held` fires only on
   * a row that is not `pending`, and neither does `contents` — so an arrival,
   * which is what `pending` means, is always alone. Measured on the development
   * catalogue of 2026-09-07: 1 440 `held`, 11 `contents`+`held`, 52 `arrival`,
   * and no combination with an arrival in it.
   */
  subs: Array<'arrival' | 'held' | 'contents'>;
}

/**
 * What a chip states it would leave — counted over the union under every
 * other filter the curator has set. Mirrors the backend's `QueueFacets`
 * (`reviewQueueKeys.ts`) field for field.
 */
export interface QueueFacets {
  kind: Array<{
    kind: 'conflict' | 'waiting' | 'withdrawn' | 'refused' | 'missing' | 'arrival' | 'held' | 'contents';
    count: number;
  }>;
  source: Array<{ id: number; name: string; count: number }>;
  /**
   * `id` null is the unplaced bucket: keys with no region row at all.
   *
   * `worldView` is the world view this root is a root of — null on the unplaced
   * row, which is in none. Two roots are called Europe (world views 2 and 5),
   * so a control listing the bare name would offer a curator two identical
   * rows; the chip prints the world view where a name repeats.
   */
  region: Array<{ id: number | null; name: string; worldView: string | null; count: number }>;
  /**
   * The runs with open questions, counted before the set-aside exclusion —
   * `setAside` says whether this curator has already hidden the batch, which
   * is what a chip needs to name it and bring it back. `completedAt` is
   * `null` for a run still in flight.
   */
  run: Array<{ id: number; sourceId: number; completedAt: string | null; count: number; setAside: boolean }>;
  /** How many runs this curator has set aside — the unit the chip names. */
  setAside: { batches: number };
}

export interface ReviewQueue {
  missing: ReviewQueueItem[];
  /** Rows a rule turned down and nobody has answered yet. Already hidden from readers (ADR-0024). */
  refused: ReviewQueueItem[];
  /**
   * Refusals a curator confirmed. Answered, not waiting — carried here because
   * this is the only surface they appear on at all: every read hides them, so
   * without this list a confirmed refusal could never be taken back.
   */
  keptOut: ReviewQueueItem[];
  conflicts: ReviewQueueItem[];
  /**
   * The three kinds a gated source leaves open (ADR-0025). Kept apart here
   * because each is one query; the page groups them by experience, since a
   * museum whose label is `held` and which gained twelve `contents` is one
   * decision to a curator.
   *
   * An arrival is always alone: `held` fires only on a row that is not
   * `pending`, and `contents` hides a `pending` container outright.
   */
  arrivals: ReviewQueueItem[];
  held: ReviewQueueItem[];
  contents: ReviewQueueItem[];
  /**
   * Objects that lost a point the source stopped offering, waiting on a verdict
   * (ADR-0026). One entry per object, listing the points inside it, because a
   * serial site can lose two components in one run — and the verdict is per point.
   */
  withdrawn: ReviewQueueItem[];
  /**
   * The withdrawn points a curator has answered, carried for the reason `keptOut` is —
   * one level down. Answering is what took them out of `withdrawn`, and every
   * reader-facing read hides a point that is withdrawn or declared gone, so without this
   * list a verdict on a point could never be taken back (#544).
   */
  answeredWithdrawals: ReviewQueueItem[];
  /**
   * The unread points and works a curator turned down, carried for the reason the
   * two lists above are: the refusal is a mark nothing else shows (ADR-0053), so
   * without this list a mis-click on *Turn them down* could be found only in the
   * curation log and undone nowhere (#859). One entry per object, listing both
   * kinds inside it, because the take-back is per part.
   */
  refusedParts: ReviewQueueItem[];
  limit: number;
  /**
   * The page in the one order across all seven kinds (ADR-0051) — what the
   * client actually draws. The seven arrays above are a lookup by id beside
   * it, not an order of their own.
   */
  order: QueueOrderEntry[];
  /** Counted over the union under the filter the curator set — the keys phase's own count, not a client-side sum of the seven arrays. */
  total: number;
  facets: QueueFacets;
  /**
   * The one cursor the seven open kinds share, beside the three offsets that
   * page the three answered lists on their own: `keptOut`,
   * `answeredWithdrawals` and `refusedParts` are not open questions, carry no
   * date to order the union by, and only ever grow, so a `COUNT(*)` would tell
   * a curator nothing an offset and `hasMore` do not already.
   */
  paging: {
    cursor: string | null;
    nextCursor: string | null;
    keptOut: { offset: number; hasMore: boolean };
    answeredWithdrawals: { offset: number; hasMore: boolean };
    refusedParts: { offset: number; hasMore: boolean };
  };
}

/**
 * The three answered lists that still page by their own offset, outside the
 * cursor order: `keptOut`, `answeredWithdrawals` and `refusedParts` are not
 * open questions and only ever grow, so `fetchReviewQueue`'s `keptOutOffset` /
 * `answeredWithdrawalsOffset` / `refusedPartsOffset` name them by this word.
 */
export type ReviewQueueKind = 'keptOut' | 'answeredWithdrawals' | 'refusedParts';

/**
 * What needs a curator's judgement, within their scope — a filtered,
 * ordered, cursor-paged page (ADR-0051). `params` is the review page's
 * address (`ReviewAddress`) plus the cursor and the three offsets the answered
 * lists still page by; `row` names the selected card for a deep link and is
 * not a request parameter, so it is not sent here.
 */
export async function fetchReviewQueue(params: ReviewAddress & {
  cursor?: string;
  limit?: number;
  keptOutOffset?: number;
  answeredWithdrawalsOffset?: number;
  refusedPartsOffset?: number;
}): Promise<ReviewQueue> {
  const search = new URLSearchParams();
  if (params.sort === 'question') search.set('sort', params.sort);
  if (params.q) search.set('q', params.q);
  if (params.sourceIds.length > 0) search.set('source', params.sourceIds.join(','));
  if (params.kinds.length > 0) search.set('kind', params.kinds.join(','));
  if (params.regionId !== null) search.set('region', String(params.regionId));
  if (params.runId !== null) search.set('run', String(params.runId));
  if (params.showAside) search.set('aside', 'show');
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.keptOutOffset) search.set('keptOutOffset', String(params.keptOutOffset));
  if (params.answeredWithdrawalsOffset) {
    search.set('answeredWithdrawalsOffset', String(params.answeredWithdrawalsOffset));
  }
  if (params.refusedPartsOffset) {
    search.set('refusedPartsOffset', String(params.refusedPartsOffset));
  }
  return authFetchJson<ReviewQueue>(`${API_URL}/api/experiences/review/queue?${search}`);
}

/**
 * A curator's "not now" on a whole run's batch of open questions (ADR-0051
 * decision 4). `bringRunBack` is the way back. Both echo the run id and the
 * state the caller asked for — a second click on either is the same 200 as
 * the first (`reviewQueueSetAside.ts`).
 */
export async function setRunAside(syncLogId: number): Promise<{ syncLogId: number; setAside: boolean }> {
  return authFetchJson(`${API_URL}/api/experiences/review/set-aside/${syncLogId}`, {
    method: 'PUT',
  });
}

/** Undoes `setRunAside`: brings a set-aside run's batch back into view. */
export async function bringRunBack(syncLogId: number): Promise<{ syncLogId: number; setAside: boolean }> {
  return authFetchJson(`${API_URL}/api/experiences/review/set-aside/${syncLogId}`, {
    method: 'DELETE',
  });
}

/** The two answers every review row has, and the third two kinds have (#852). */
export type ReviewAnswer = 'accept' | 'reject' | 'lost';

/** A row as the batch names it: the server's kind word, the object, the run it was asked by. */
export interface ReviewAnswerRow {
  kind: QueueOrderEntry['kind'];
  id: number;
  runId: number | null;
}

/** What one answer did, counted — mirrors the backend's `Did` (`reviewAnswerDispatch.ts`). */
export interface ReviewAnswerDid {
  published?: number;
  locations?: number;
  treasureLinks?: number;
  treasures?: number;
  withdrawalsReleased?: number;
  fields?: number;
  points?: number;
  pointsRefused?: number;
}

/** The report of one request — mirrors the backend's `ReviewAnswerResult`. */
export interface ReviewAnswerResult {
  answer: ReviewAnswer;
  answered: Array<{
    kind: QueueOrderEntry['kind']; id: number; name: string; answer: ReviewAnswer; did: ReviewAnswerDid;
  }>;
  refused: Array<{ kind: QueueOrderEntry['kind']; id: number; name: string; error: string }>;
  outOfScope: number;
  placementFailed: Array<{
    id: number; name: string; worldViews: Array<{ id: number | null; name: string | null }>;
  }>;
}

/** The most rows one request answers — the queue's own page maximum. */
export const REVIEW_ANSWER_ROWS_MAX = 100;

/**
 * Answer a page of review rows with one answer (#852). Each object is its own act
 * on the server, so the report names what refused rather than failing the batch.
 */
export async function answerReviewRows(
  rows: ReviewAnswerRow[],
  answer: ReviewAnswer,
): Promise<ReviewAnswerResult> {
  return authFetchJson(`${API_URL}/api/experiences/review/answer`, {
    method: 'POST',
    body: JSON.stringify({ rows, answer }),
  });
}
