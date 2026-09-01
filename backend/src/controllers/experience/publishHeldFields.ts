/**
 * The held-proposal half of publishing: turning what a run proposed into columns.
 *
 * Its own module because it is its own responsibility, and because it has no
 * dependency on the transaction shell that calls it — no lock, no refusal, no
 * audit row, no pool. What lives here is the answer to one question: given the
 * `changed_fields` a gated run recorded rather than wrote, which columns does
 * publishing assign, and which does it deliberately leave alone? The shapes that
 * makes hard are all per-column — a jsonb column assigned whole, one geometry
 * built from a pair, and the two columns no single changeset entry describes:
 * `metadata`, reported one key at a time since ADR-0039, and `name_local`, one
 * language at a time since #728. Those two are merged onto what is stored rather
 * than assigned, by one function, because they are one shape.
 *
 * `publishController.ts` holds the other half: the lock, the staleness check, the
 * contents, the released withdrawal, the placement and the audit line.
 */

import {
  CURATED_KEY_BY_FIELD, METADATA_CLAIM_PREFIX, NAME_LOCAL_CLAIM_PREFIX, claimKeyFor,
} from '../../services/sync/changeSet.js';
import type { ContentsByKind } from '../../services/sync/types.js';
import {
  answeredHeldRows, heldRowKey, type HeldAnswer, type HeldRowRef,
} from './heldDecisions.js';
import { namedRowReached, selectedFilter, type HeldSelection } from './heldSelection.js';
import type { PoolClient } from 'pg';
import { isDisplayablePictureUrl } from '../../types/urlSafety.js';

/** One entry of a run's `changed_fields`, as the changeset stores it. */
interface ProposedField {
  field: string;
  old?: unknown;
  new?: unknown;
  curatedConflict?: boolean;
  /** The category's gate kept this write out, and publishing is its answer. */
  held?: boolean;
}

/**
 * Does this field share the `metadata` column with the rest of its family?
 *
 * Every `metadata.<key>` does, and since ADR-0039 that is every key a source can
 * name — `metadata.criteria`, `metadata.imageCredit`, whatever a portal invents
 * next — plus the bare `metadata` a card filed earlier still carries. The test
 * is the prefix, deliberately, and not a lookup in `CURATED_KEY_BY_FIELD`: that
 * map answers a different question (which claim protects a field) and names only
 * three of these, so a reader checking `metadata.criteria` against it would find
 * nothing and conclude the field goes looking for a column of its own.
 *
 * None of them can be written by assignment one at a time — they are one jsonb
 * column — so `assignmentFor` returns null for the family and `nextMetadata`
 * resolves them together.
 */
function isMetadataField(field: string): boolean {
  return field === 'metadata' || field.startsWith(METADATA_CLAIM_PREFIX);
}

/**
 * Does this field share the `name_local` column with the rest of its family?
 *
 * The second column an entry cannot be assigned from, and for the same reason
 * (#728): a run records each language that differs as `nameLocal.<lang>`, and
 * six of those are one jsonb column. The bare `nameLocal` a card filed before
 * that still carries belongs to the family too — it named the whole map, which
 * `mergedFromEntries` replaces wholesale exactly as it does a metadata
 * catch-all.
 */
function isNameLocalField(field: string): boolean {
  return field === 'nameLocal' || field.startsWith(NAME_LOCAL_CLAIM_PREFIX);
}

/** A field publishing resolves against the stored column rather than assigning. */
function isMergedColumn(field: string): boolean {
  return isMetadataField(field) || isNameLocalField(field);
}

/** A coordinate as the changeset records one, or null if that is not what this is. */
function asCoordinate(value: unknown): { lon: number; lat: number } | null {
  const point = value as { lon?: unknown; lat?: unknown } | null;
  if (!point || typeof point !== 'object') return null;
  if (typeof point.lon !== 'number' || typeof point.lat !== 'number') return null;
  if (!Number.isFinite(point.lon) || !Number.isFinite(point.lat)) return null;
  return { lon: point.lon, lat: point.lat };
}

/**
 * The `SET` clause that writes one proposed field, or null if this endpoint has
 * no assignment for it.
 *
 * The column comes from `CURATED_KEY_BY_FIELD` rather than a second map of the
 * same thing — the upsert honours that map, so a private copy here would drift
 * from what a run actually refused to write. What this adds is per-column
 * *shape*, which the map does not carry: one of the columns it still assigns is
 * jsonb, one is a geometry built from a pair, and the rest take the value as it
 * stands.
 *
 * `null` is returned for the two merged columns (resolved elsewhere), for a field
 * name the map has never heard of, and for a coordinate that is not one. The
 * caller refuses the whole request on the last two rather than publishing around
 * them: clearing the pointer while dropping a value would leave that value
 * proposed by every future run and applied by none, which is the failure this
 * writer exists to close.
 */
function assignmentFor(field: string, value: unknown, bind: (value: unknown) => string): string | null {
  if (isMergedColumn(field)) return null;
  const column = CURATED_KEY_BY_FIELD[field];
  if (column === undefined) return null;

  switch (field) {
    // A jsonb column. `JSON.stringify` of an absent value is the string 'null',
    // which lands as jsonb null rather than SQL NULL — exactly what the upsert
    // writes through the same column, so a published value and a run's own are
    // the same value.
    //
    // Still reachable for cards filed before tags stopped being held (#570):
    // a changeset records what its run did, and publishing writes what it
    // proposed. No run files a tags row any more.
    case 'tags':
      return `${column} = ${bind(JSON.stringify(value ?? null))}::jsonb`;
    case 'location': {
      // Checked rather than asserted: `location` is NOT NULL, so an
      // `ST_MakePoint(NULL, NULL)` from a value that is not a pair of numbers
      // would fail the transaction with an error naming neither the field nor
      // the reason. Returning null routes it to the caller's refusal instead,
      // which names the field and leaves the proposal intact to be looked at.
      const point = asCoordinate(value);
      if (!point) return null;
      return `${column} = ST_SetSRID(ST_MakePoint(${bind(point.lon)}, ${bind(point.lat)}), 4326)`;
    }
    case 'imageUrl':
      // The curator's rule, `isDisplayablePictureUrl` — the one their edit is
      // held to, which admits an `/images/…` path of ours beside a Commons file —
      // rather than the narrower one a run holds (`withShowablePicture`,
      // `syncUtils.ts`): publishing is a person's act on a proposal, and sits on
      // the person's side of ADR-0043. Either way a picture from a host whose
      // terms do not let this product draw it is not stored, whichever door it
      // arrives through. Publishing is the third door, and it
      // reaches back in time — a card filed before that rule can still be
      // carrying `whc.unesco.org/document/<id>` as its proposal, and applying it
      // would put the picture back on the row a repair had just taken it off.
      // Refused rather than nulled, so the curator is told which field could not
      // be published and the proposal stays to be looked at; the next run
      // re-proposes a Commons picture over it.
      if (typeof value === 'string' && value !== '' && !isDisplayablePictureUrl(value)) return null;
      return `${column} = ${bind(value)}`;
    default:
      // name, description, short_description, category, country_codes,
      // country_names. No cast: Postgres infers each parameter's type from the
      // column it is assigned to, which is how the two varchar arrays reach
      // `VARCHAR(10)[]` and `VARCHAR(255)[]` without this code having to know
      // their widths.
      return `${column} = ${bind(value ?? null)}`;
  }
}

/**
 * The key a hosted picture's credit lives under, and how to read it.
 *
 * Since ADR-0039 a run reports the credit as `metadata.imageCredit`, a fact with
 * its own answer cell, and the rule that keeps it with its picture is a coupling
 * of two selections in `heldSelection.ts` — at both levels, as it always was for
 * a work. What is left here is the column rule for the shapes that coupling does
 * not reach: a picture landing while the run's own credit entry drops the key, and a card
 * filed before ADR-0039, whose credit rides inside a `metadata` catch-all with
 * no name of its own and can therefore still be refused while the picture lands.
 */
const CREDIT_KEY = 'imageCredit';
/** The changeset name for the object's credit, now that every key has one. */
const CREDIT_FIELD = `${METADATA_CLAIM_PREFIX}${CREDIT_KEY}`;

function creditOf(metadata: unknown): unknown {
  const bag = metadata as Record<string, unknown> | null;
  if (!bag || typeof bag !== 'object') return undefined;
  return bag[CREDIT_KEY];
}

/** What the credit must become, or null where the entries may decide it. */
type CreditPin = { value: unknown } | null;

/**
 * What the run proposes for the object's credit, and what stands against it.
 *
 * Two record shapes answer to this, and both are live at once. A run since the
 * per-key change records the credit as its own `metadata.imageCredit` entry — a
 * fact with its own two buttons. A card filed before it carries the credit
 * inside the `metadata` catch-all, with no name of its own, and those cards keep
 * standing until a run re-proposes: a changeset is what happened and is never
 * rewritten (`heldDecisions.ts`). So the rule reads the named entry first and
 * falls back to the catch-all's key.
 *
 * The answer is fetched against whichever entry supplied the value, for the
 * reason the pin exists at all: a refused proposal must not steer what the
 * column may come to hold.
 */
interface CreditProposal {
  value: unknown;
  answer?: HeldAnswer;
}

function creditProposal(
  held: ReadonlyArray<ProposedField>, answered: ReadonlyMap<string, HeldAnswer>,
): CreditProposal | undefined {
  const own = held.find(field => field.field === CREDIT_FIELD);
  if (own !== undefined) {
    return { value: own.new, answer: answered.get(heldRowKey(objectRow(CREDIT_FIELD))) };
  }
  const catchAll = held.find(field => field.field === 'metadata');
  if (catchAll === undefined) return undefined;
  return {
    value: creditOf(catchAll.new),
    answer: answered.get(heldRowKey(objectRow('metadata'))),
  };
}

/**
 * Whether this call has to overrule the entries about the credit, and with
 * what.
 *
 * The rule is one sentence — **the stored credit is the credit of the stored
 * picture** — and it bites in three shapes, all of them requiring the run to
 * have said something about the credit at all: its own `metadata.imageCredit`
 * entry since ADR-0039, or the key inside a catch-all on a card filed before
 * it. `creditProposal` resolves either into one answer:
 *
 * - this call writes the picture, so the row is about to show the run's
 *   photograph and must carry the credit that row gives for it — or none,
 *   where that row drops the key: no credit beats the last photographer's name
 *   under a photograph they did not take;
 * - the same, where a curator has **refused** that row. The refused value may
 *   not be written, because refusing writes nothing (ADR-0038 decision 2), and
 *   the stored one names a photograph nobody will see any more — so the row is
 *   published with nobody credited, which `picture-with-nobody-credited`
 *   reports. The one place a refusal reaches what a reader sees, and only on a
 *   card filed before ADR-0039: `partnerOf` now makes a credit unrefusable
 *   without its picture at **both** levels, so on anything a run files from here
 *   the two answers cannot be separated. An older card's credit has no name of
 *   its own to pair with, which is why the arm stays;
 * - the run offers a *different* picture and this call is not writing it, so
 *   the row keeps the one it shows and the stored credit with it.
 *
 * A prior **publication** of the credit's row is deliberately not a fourth
 * shape. The arm above may have withheld the run's credit when that row was
 * answered, on a card whose picture was still open and different, so "published"
 * is no evidence that the column holds it; publishing the picture afterwards
 * finishes what that call had to leave, and `creditMoves` is what keeps it from
 * writing where the column already agrees.
 *
 * Everywhere else the pin is null and the entries decide — the run that
 * proposes nothing about the credit included, which is the run *asserting* the
 * stored one rather than offering none. That is not a corner but the ordinary
 * case: measured on this catalogue, 1413 of the 1414 cards holding a credit hold
 * no picture change at all — the run fetched the photographer for the picture
 * the page has been showing all along, and publishing that change is what
 * finally names them (`data-assertions.md` § picture-with-nobody-credited). A
 * rule that fired there would delete the credit and mark the row answered, so no
 * later run would offer it again.
 *
 * A picture the run proposes that already equals the stored one is the same
 * ordinary case: the row already shows what the run offers, so the credit beside
 * it belongs to what a reader is looking at.
 */
function creditPin(
  proposal: { picture?: ProposedField; credit?: CreditProposal },
  stored: { imageUrl: unknown; credit: unknown },
  writesPicture: boolean,
): CreditPin {
  // A run that proposes nothing about the credit is asserting the one that is
  // stored: a key is reported only where it differs. So there is nothing to
  // overrule — reading the silence as "the run offers no credit" would delete
  // one the run is still standing behind, on any call that publishes the
  // picture.
  if (proposal.credit === undefined) return null;

  if (writesPicture) {
    // Refused, and the picture is landing anyway — two clicks a curator can
    // really make, "not this" on the source data and then "publish this" on
    // the photograph. The run's credit may not be written, because refusing
    // writes nothing (ADR-0038 decision 2); the stored one may not stay,
    // because it names the photographer of a picture nobody will see any more.
    // So the row shows the new photograph with nobody credited, which is the
    // honest outcome and which `picture-with-nobody-credited` reports.
    if (proposal.credit.answer === 'refused') return { value: undefined };
    // Otherwise the row takes what the run's credit row gives — or none, where
    // that row drops the key. Including where the row was *published*
    // earlier: the credit may have been held back then, by the arm below, on a
    // card whose picture was still open and different, so "published" is no
    // evidence that the column holds it. `creditMoves` is what keeps this from
    // writing where it already does.
    return { value: proposal.credit.value };
  }

  if (proposal.picture === undefined) return null;
  const offered = JSON.stringify(proposal.picture.new ?? null);
  return offered === JSON.stringify(stored.imageUrl ?? null) ? null : { value: stored.credit };
}

/** Keys a curator claimed individually, as bare key names. */
function claimedMetadataKeys(claimed: string[]): string[] {
  return claimed
    .filter(key => key.startsWith(METADATA_CLAIM_PREFIX))
    .map(key => key.slice(METADATA_CLAIM_PREFIX.length));
}

/**
 * The object a column's selected entries come to, before any rule on top of it.
 *
 * One function for both merged columns, because the shape is one shape: a run
 * records a fact per key — a metadata key since ADR-0039, a language since #728
 * — and an entry filed before that named the whole object at once. Its own
 * function because it is the awkward half and `nextMetadata` has two decisions
 * on top of it: the credit rule and the per-key claims.
 *
 * `whole` is the entry that names the column itself, `prefix` what a per-key
 * entry's name starts with. The whole-object branch keeps the stored keys that
 * entry's `old` does not mention and replaces everything it does — which is the
 * catch-all rule `nextMetadata` explains, and which is also exactly right for a
 * pre-#728 `nameLocal` entry, whose `old` is the stored map entire and which
 * therefore replaces the column wholesale.
 */
function mergedFromEntries(
  left: Record<string, unknown>, entries: ProposedField[], whole: string, prefix: string,
): Record<string, unknown> {
  const catchAll = entries.find(field => field.field === whole);
  const next = catchAll
    ? {
      ...Object.fromEntries(Object.entries(left)
        .filter(([key]) => !Object.hasOwn((catchAll.old ?? {}) as Record<string, unknown>, key))),
      ...((catchAll.new ?? {}) as Record<string, unknown>),
    }
    : { ...left };

  for (const entry of entries) {
    if (entry.field === whole) continue;
    const key = entry.field.slice(prefix.length);
    // Absent and null are one case here, not two: `computeChangeSet` treats
    // both as absent, so a diff reporting either means the key is going.
    if (entry.new === undefined || entry.new === null) delete next[key];
    // `defineProperty` rather than assignment, because the key comes from the
    // source. A metadata key literally named `__proto__` hits the accessor on
    // `Object.prototype` instead of creating a property: the value would land
    // on this object's prototype, `JSON.stringify` would not see it, and the
    // column would be written without the fact a curator had just published —
    // success reported, nothing stored. Only reachable since every source key
    // became an entry of its own (ADR-0039); before that this loop saw the two
    // major keys and whatever a curator had claimed. A language code cannot be
    // `__proto__`, but the defence belongs to the loop rather than to one of
    // its two callers.
    else Object.defineProperty(next, key, {
      value: entry.new, enumerable: true, writable: true, configurable: true,
    });
  }
  return next;
}

/**
 * The metadata to store, or null when the proposal says nothing about it.
 *
 * One of the two columns that cannot be assigned from what the changeset
 * carries (`nextNameLocal` below is the other, and the simpler).
 * `computeChangeSet` reports metadata one key at a time (ADR-0039), so for
 * anything a run files from here this starts at what is stored and lets each
 * `metadata.<key>` entry decide its own key.
 *
 * The catch-all branch below is **live, not dead**, and ADR-0039 decision 4 is
 * why: a changeset is what happened and is never rewritten, so a card filed
 * before the change keeps its shape until a run re-proposes. Such a card
 * reported metadata in parts and stripped the individually reported keys out of
 * *both sides* before diffing the rest, so its catch-all's `new` is not the
 * source's object but the source's object minus those keys, and assigning it
 * would delete every one of them. What it does carry is its `old`: the stored
 * object minus the same stripped keys. A stored key its `old` does not mention
 * is therefore a key the catch-all was not speaking for, and is kept; everything
 * it does speak for is replaced by its `new` wholesale.
 *
 * Replacing wholesale rather than merging with `||` is the point of the whole
 * arrangement. A key the source dropped is recorded only by its absence from
 * `new`, so a merge would keep it — the run would propose the same removal for
 * ever and this endpoint would clear the pointer without applying it.
 *
 * Last, whatever the curator claims per key is re-applied from what is stored,
 * mirroring the upsert's own re-application (`syncUtils.ts`) including its
 * condition: only where the stored row still carries the key, because a claim
 * whose key is gone falls straight through there too. A claim made *after* the
 * run is what makes this necessary: the proposal was computed against a row
 * nobody had claimed the key on, so filtering claimed fields out of it cannot
 * reach the key, and publishing would quietly overwrite a curator's own link.
 */
function nextMetadata(
  stored: unknown,
  published: ProposedField[],
  claimed: string[],
  pin: CreditPin,
): Record<string, unknown> | null {
  const entries = published.filter(field => isMetadataField(field.field));
  const storedCredit = creditOf(stored);
  // A pin can force a write with no metadata entry selected at all: publishing
  // the picture alone has to carry the credit the run fetched for it.
  const creditMoves = pin !== null
    && JSON.stringify(pin.value ?? null) !== JSON.stringify(storedCredit ?? null);
  if (entries.length === 0 && !creditMoves) return null;

  const left = (stored ?? {}) as Record<string, unknown>;
  const next = mergedFromEntries(left, entries, 'metadata', METADATA_CLAIM_PREFIX);

  // The credit, where and only where leaving it to the entries would make it
  // describe a picture the row does not show (#722). The picture and the credit
  // are two answerable rows, so publishing the picture alone would leave the
  // credit naming the *previous* photograph's author.
  //
  // The coupling of the two rows is `partnerOf`'s job and covers anything a run
  // files since ADR-0039. What is left here are the shapes it does not reach: a
  // picture landing while the run's credit entry drops the key, and a card filed
  // earlier, whose credit rode inside a catch-all that also carried the criteria
  // and the region and could therefore be refused on its own. Not a rule that
  // fires on every call either: `creditPin` returns null wherever the run's
  // credit is already the stored picture's, which is 1413 of the 1414 cards
  // holding a credit on this catalogue.
  if (pin !== null) {
    if (pin.value === undefined || pin.value === null) delete next[CREDIT_KEY];
    else next[CREDIT_KEY] = pin.value;
  }

  // Last, and after the credit on purpose: a curator who claimed the credit on
  // its own (`editExperience` claims `metadata.imageCredit` where the edit put
  // a value in it) has answered this question already, and their value wins
  // over the rule above exactly as it wins over the catch-all.
  for (const key of claimedMetadataKeys(claimed)) {
    if (Object.hasOwn(left, key)) next[key] = left[key];
  }
  return next;
}

/**
 * The local names to store, or null when the proposal says nothing about them.
 *
 * The second column no single entry describes (#728). A run records each
 * language that differs on its own — `nameLocal.ko`, `nameLocal.en` — so
 * publishing one of six starts at the stored map and lets that one entry decide
 * its own language, leaving the five a curator has not answered exactly as
 * readers see them. Merging rather than assigning is what makes a per-row answer
 * mean anything here at all: assigned, publishing the Korean name would write
 * the run's whole map and take the other five with it.
 *
 * A language the source dropped is recorded only as an entry with no value, and
 * `mergedFromEntries` deletes on that — so publishing every entry of a run
 * reproduces the map the run itself would have written, which is what stops a
 * removal being proposed for ever and applied never.
 *
 * Shorter than `nextMetadata` by two rules, and neither is missing by oversight.
 * There is no credit to pin: a language map holds no fact that belongs to
 * another column. And there is no per-key claim to re-apply, because none can
 * exist — `curated_fields ? 'name_local'` is the upsert's whole guard and no
 * editor writes the column, so a claim here covers every language and
 * `claimKeyFor` has already kept all of them out of `writable`.
 */
function nextNameLocal(
  stored: unknown, published: ProposedField[],
): Record<string, unknown> | null {
  const entries = published.filter(field => isNameLocalField(field.field));
  if (entries.length === 0) return null;
  return mergedFromEntries(
    (stored ?? {}) as Record<string, unknown>, entries, 'nameLocal', NAME_LOCAL_CLAIM_PREFIX,
  );
}

/** What writing the held proposal comes to: the SQL, and what it decided. */
export interface HeldFieldWrites {
  assignments: string[];
  /** `$1` is the experience id; the rest is whatever the assignments bound. */
  params: unknown[];
  applied: string[];
  claimedFieldsSkipped: string[];
  /** Held fields this writer cannot produce. Any at all refuses the whole call. */
  unwritable: string[];
  /**
   * The row points at a run whose changeset row is not there.
   *
   * Distinct from "the proposal is empty", which is what an absent row used to
   * be read as: publishing then applied nothing, cleared the pointer and
   * reported success, so a curator was told they had published a proposal whose
   * values were never written and whose record was gone. `accept-source`
   * refuses this case outright (`No source proposal on record for this
   * experience`), and the two endpoints answering the same question differently
   * is how a curator learns not to trust either.
   *
   * Reachable rather than theoretical: `recordSyncChanges` writes a run's whole
   * changeset as one batched insert, and the admin screen has an alert for that
   * insert failing — a run whose pointer landed and whose changeset did not is
   * exactly that failure.
   */
  proposalMissing: boolean;
  /**
   * The contents record on the same changeset row, for the held fields of the
   * object's parts (`publishHeldParts.ts`, ADR-0037). Read here rather than
   * twice: one row, one read, under the one lock.
   */
  contents: ContentsByKind | null;
  /**
   * The held rows of this proposal — both levels — that already carry an answer
   * (#722). Read here for the same reason `contents` is: one lock, one read, and
   * the parts' planner takes it rather than asking again.
   */
  answered: Map<string, HeldAnswer>;
  /**
   * What this call writes, as the answer record names it. Written after the
   * UPDATE lands, so a card that keeps its pointer stops offering a value it has
   * already applied.
   */
  written: Array<{ row: HeldRowRef; value: unknown }>;
  /**
   * Held fields of the object's own that this call does not answer — open before
   * it and open after it.
   *
   * Empty for a call that names no selection, which answers the whole card. What
   * this decides is the pointer: it is cleared only where nothing on the card is
   * left open at either level, so publishing one row of six leaves the other
   * five on the card rather than clearing them unanswered.
   */
  leftOpen: HeldRowRef[];
  /**
   * Rows the caller named that carry no open held proposal. Any at all refuses
   * the call, for the reason `unwritable` does: a click that answered nothing
   * must not come back as success.
   */
  unmatched: string[];
}

/** How the answer record names one of the object's own fields. */
function objectRow(field: string): HeldRowRef {
  return { kind: null, ref: null, name: null, field };
}

/**
 * Turn the run's held proposal into assignments, deciding what to skip.
 *
 * Reads the changeset inside the caller's transaction, under the lock the caller
 * already holds, so the proposal that is written is the one the pointer named at
 * lock time rather than whatever was newest when the request arrived.
 *
 * `selection` is the rows the curator answered, or null for the whole card
 * (#722). A selection narrows three things and nothing else: what is written,
 * what an unwritable field can refuse the call over — a field this call does not
 * name is not this call's problem — and what is left open afterwards, which is
 * what decides the pointer.
 */
export async function heldFieldWrites(
  client: PoolClient,
  experienceId: number,
  pointer: number | null,
  before: { metadata?: unknown; image_url?: unknown; name_local?: unknown },
  claimed: string[],
  selection: HeldSelection | null = null,
): Promise<HeldFieldWrites> {
  const params: unknown[] = [experienceId];
  const bind = (value: unknown) => `$${params.push(value)}`;
  const writes: HeldFieldWrites = {
    assignments: [], params, applied: [], claimedFieldsSkipped: [], unwritable: [],
    proposalMissing: false, contents: null, answered: new Map(), written: [],
    leftOpen: [], unmatched: [],
  };
  // A row holding nothing reaches none of the rows a selection names, and the
  // caller has to be told rather than answered with a success that wrote
  // nothing: the card they clicked was answered by somebody else, or a later
  // run withdrew it. Computed before the early return, since everything below
  // it reads a proposal that is not there. The parts' half needs no equivalent
  // — its planner walks an empty record and reports every named part row.
  if (pointer === null) {
    return { ...writes, unmatched: [...(selection?.fields ?? [])] };
  }

  const proposal = await client.query(
    `SELECT changed_fields, contents FROM experience_sync_changes
      WHERE experience_id = $1 AND sync_log_id = $2
      ORDER BY id DESC LIMIT 1`,
    [experienceId, pointer],
  );
  if (proposal.rows.length === 0) return { ...writes, proposalMissing: true };
  const proposed = (proposal.rows[0].changed_fields ?? []) as ProposedField[];
  writes.contents = (proposal.rows[0].contents ?? null) as ContentsByKind | null;
  // Only what the *gate* held, and read off the field's own flag rather than
  // inferred from the absence of a claim (#519). A field the curator had claimed
  // is refused for its own reason, carries `curatedConflict`, and is answered
  // through `accept-source`; the queue's `held` card filters on this same flag,
  // so this writes exactly what that card showed and nothing beside it. An
  // elimination here would apply any future third kind of refused write as though
  // the gate had held it, which is the one thing this endpoint must not do: it
  // writes all eleven content columns.
  const held = proposed.filter(field => field.held === true);

  // A row the curator has already answered — published one field of six last
  // week, or refused this one — is settled, and the queue's card has dropped it
  // (#722). Skipped here for the same reason a claim is skipped: this endpoint
  // writes what the card showed, and nothing beside it.
  writes.answered = await answeredHeldRows(client, experienceId, pointer);
  const open = held.filter(field => !writes.answered.has(heldRowKey(objectRow(field.field))));

  // What this call answers: the rows it named, or all of them where it named
  // none. What it does not name stays open, which is what keeps the pointer.
  const names = selectedFilter(selection);
  const selected = open.filter(field => names(objectRow(field.field)));
  writes.leftOpen = open
    .filter(field => !selected.includes(field))
    .map(field => objectRow(field.field));
  if (selection) {
    // Through `namedRowReached`, not a bare field-name test. The matcher widens
    // an object's selection across the picture/credit pairing now, so accounting
    // that did not would refuse a body `decline-held` accepts: naming both on a
    // card that holds only the picture reaches one row, which is a match and not
    // an unmatched name. Two copies of this question drifting apart is the shape
    // that produced the defect the export exists to prevent.
    const reached = new Set(selected.map(field => heldRowKey(objectRow(field.field))));
    writes.unmatched = (selection.fields ?? [])
      .filter(field => !namedRowReached(reached, objectRow(field)));
  }

  // A claim made since the run is an answer someone already gave about whose
  // text this is, and publishing answers a different question — may readers see
  // this. So a claimed field is skipped by the writer, and is not a reason to
  // refuse the request: both questions can be open at once.
  writes.claimedFieldsSkipped = selected
    .filter(field => claimed.includes(claimKeyFor(field.field)))
    .map(field => field.field);
  const writable = selected.filter(field => !writes.claimedFieldsSkipped.includes(field.field));

  for (const field of writable) {
    if (isMergedColumn(field.field)) continue;
    const assignment = assignmentFor(field.field, field.new, bind);
    if (assignment === null) writes.unwritable.push(field.field);
    else {
      writes.assignments.push(assignment);
      writes.applied.push(field.field);
    }
  }

  // Both halves read off the *whole* held set rather than off what this call
  // selected: a curator publishing the picture alone still gets the credit the
  // run fetched for it, and one publishing the source's data has to be measured
  // against the picture the run is offering whether or not they answered it.
  const pin = creditPin(
    {
      picture: held.find(field => field.field === 'imageUrl'),
      // Read off the *whole* held set, then asked what answer stands against
      // it: the row may have been answered already, and a refused proposal
      // must not steer a rule about what the column may hold.
      credit: creditProposal(held, writes.answered),
    },
    { imageUrl: before.image_url, credit: creditOf(before.metadata) },
    writes.applied.includes('imageUrl'),
  );
  const metadata = nextMetadata(before.metadata, writable, claimed, pin);
  if (metadata !== null) {
    writes.assignments.push(`metadata = ${bind(JSON.stringify(metadata))}::jsonb`);
    writes.applied.push(...writable.filter(field => isMetadataField(field.field)).map(f => f.field));
  }
  // The other column an entry cannot assign (#728). Unlike metadata's, this one
  // is decided by its entries alone, so an empty selection leaves it alone —
  // there is no pin that can force a write with nothing selected.
  const nameLocal = nextNameLocal(before.name_local, writable);
  if (nameLocal !== null) {
    writes.assignments.push(`name_local = ${bind(JSON.stringify(nameLocal))}::jsonb`);
    writes.applied.push(...writable.filter(field => isNameLocalField(field.field)).map(f => f.field));
  }
  // The answer record, keyed on what the run proposed rather than on what landed
  // in the column: the readers compare against the proposal, and the two merged
  // columns are each written as a whole object no single entry describes.
  writes.written = writes.applied.map(name => ({
    row: objectRow(name),
    value: writable.find(field => field.field === name)?.new,
  }));
  return writes;
}

/**
 * The three assignments that make the row itself published.
 *
 * `published_at` is stamped only where the row was actually invisible until now,
 * which is narrower than `COALESCE(published_at, NOW())` on its own and for a
 * second reason. The first is the New chip: a later pass over an already-visible
 * object must not restart its window, which COALESCE handles. The second is the
 * rows that predate the gate — 1603 of the catalogue's 1604, measured
 * 2026-08-11, visible for months with `published_at` NULL because migration 018
 * deliberately did not date them — where COALESCE would not restart a window but
 * invent one, claiming today as the day a reader could first see something they
 * have been able to see all along.
 *
 * Resolved here rather than as a `CASE` over the pre-update state, because the
 * state was read under the lock and TypeScript can answer it — see
 * `setExperienceAdmission` for what a parameter used as both a value and a
 * comparand costs. COALESCE stays inside the branch as a floor: nothing today
 * can return a published row to `pending`, so it is unreachable rather than
 * wrong.
 *
 * Clearing the pointer is the line that makes a `held` card answerable at all.
 * Before it, only a later run proposing nothing ever cleared one.
 *
 * `leftOpen` is what makes that clear conditional (#722). The pointer is what
 * the card is keyed on, so clearing it takes the whole card away — right for the
 * call that answers all of it, and wrong for one that answers one row of six:
 * the other five would leave the queue unanswered and unfindable, since nothing
 * else names the run they belong to. A call that names no selection leaves
 * nothing open and clears the pointer exactly as every call did before.
 */
export function publicationAssignments(
  before: { curation_state?: unknown }, leftOpen = 0,
): string[] {
  const assignments = [`curation_state = 'verified'`];
  if (before.curation_state === 'pending') {
    assignments.push('published_at = COALESCE(published_at, NOW())');
  }
  if (leftOpen === 0) assignments.push('pending_change_sync_log_id = NULL');
  return assignments;
}
