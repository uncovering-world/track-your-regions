/**
 * The object upsert: what a run writes about a place, and about the place's
 * membership in the kind the run's source fills (ADR-0045 decision 4; #822).
 *
 * **The hold, and why the row is locked in a statement of its own.** A gated
 * source may not overwrite what a reader can already see (ADR-0025 decision
 * 5): the proposal is kept, filed as held, and a curator answers it. Whether a
 * reader can see the place is a question about its memberships since #822 —
 * some membership of it has been passed — and that lives on another table,
 * which neither an `ON CONFLICT DO UPDATE` nor the locking read itself can
 * see fresh: a statement's snapshot is taken before it waits for the row
 * lock, and once the lock is granted only the locked row is re-read
 * (`db/locks.ts`), so a publish landing in that wait would have the run
 * overwrite what the curator had just put in front of readers, with nothing
 * failing. That is the shape of #519, one table over. So the row is locked
 * *first*, in a statement of its own (`OBJECT_LOCK`, the mode every curator
 * write takes on the same row); the `before` snapshot and the hold are read
 * in the next statement, whose snapshot postdates the lock; and the write
 * takes the answer as a parameter. Publishing locks the same row, so the two
 * serialise, and what the report says was held is what the write was told —
 * one value, bound once.
 *
 * **The membership rides in the same statement.** A place a run creates gets
 * its membership in the same `INSERT`: the kind its source fills, the source,
 * the work that qualified a museum (`admitted_for`), and the gate state —
 * `pending` with no `published_at` under a gate, `auto` and now otherwise. On
 * conflict the membership keeps its state — publishing is a curator's act —
 * and takes only the run's own bookkeeping and the pointer rule: a held
 * membership keeps the pointer it has, one no longer held loses it. The
 * identity arbiter `UNIQUE(category_id, external_id)` means the place a run
 * conflicts with is one its own source created, so the membership it meets
 * is its own; a second source of one kind meeting the first's membership is
 * #628's design, not this statement's.
 *
 * **Three follow-ups, on the same connection, before the commit**: a trusted
 * source's change retires the curator's pass on the membership, a gated
 * source's proposal points the membership at this run, and a run that
 * proposed nothing clears a pointer the row no longer needs. Each is its own
 * statement because the upsert cannot tell a content change from a pass that
 * touched nothing — its CASE arms fire either way.
 *
 * A preview (`dryRun`) asks the hold rule of the same memberships with one
 * unlocked SELECT and writes nothing.
 */

import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../../db/index.js';
import { OBJECT_LOCK } from '../../db/locks.js';
import { MEMBERSHIPS, placeVisibleSql } from '../../db/membership.js';
import { pointHeldProposalAt } from './heldProposalPointer.js';
import {
  computeChangeSet, METADATA_CLAIM_PREFIX, METADATA_SET_KEYS, SYNC_OWNED_METADATA_KEYS,
  type ChangeSetResult, type ExperienceSnapshot,
} from './changeSet.js';
import { tidyLabel } from './labelFold.js';
import { isCommonsPictureUrl } from '../../types/urlSafety.js';

export interface ExperienceUpsertParams {
  categoryId: number;
  externalId: string;
  name: string;
  nameLocal: Record<string, string>;
  description: string | null;
  shortDescription: string | null;
  /**
   * The type within the kind — `cultural` for a World Heritage site, `monument`
   * for public art — and `null` for a museum, whose kind has no types (ADR-0045,
   * #814). The kind is the one `categoryId`'s source fills.
   */
  type: string | null;
  tags: string[];
  lon: number;
  lat: number;
  countryCodes: string[];
  countryNames: string[];
  imageUrl: string | null;
  metadata: Record<string, unknown>;
  /**
   * The work whose fame qualified a museum for the works-first source
   * (ADR-0023): the reason the membership exists, written on it. A run's own
   * bookkeeping, never proposed to a curator (#571); absent for a source whose
   * rule is not a work.
   */
  admittedFor?: { qid: string; label: string } | null;
}

export interface UpsertOutcome {
  experienceId: number;
  changeSet: ChangeSetResult;
  nameSnapshot: string;
  /**
   * The source has produced a row it had stopped offering — either one still
   * carrying `missing_since`, or one a curator had already called `former`,
   * whose verdict is what cleared the flag.
   */
  returnedFromMissing: boolean;
}

/**
 * The hold, as one SQL expression: the source is gated, and a reader can
 * already see the place — some membership of it has been passed. A place
 * still unread has nothing to protect, so it keeps being refreshed in place
 * and the curator reviews the newest state rather than whatever arrived first.
 *
 * A function, because the locked read and the preview alias the row
 * differently; the rule itself exists exactly once.
 */
const heldSql = (gate: string, alias: string) => `(${gate} AND ${placeVisibleSql(alias)})`;
const GATE = '(SELECT requires_curation FROM experience_categories WHERE id = $1)';
/** The form of the read under the lock, off the row the statement before it locked. */
const LOCKED_HELD = heldSql(GATE, 'e');
/** The preview's form: one SELECT, no lock. */
const PREVIEW_HELD = heldSql(GATE, 'experiences');
/**
 * The upsert's form: the answer the locked read gave, bound as `$17` and read
 * off its own CTE, so every guard below and the membership arm read one value.
 */
const HELD = '(SELECT held FROM hold)';

/**
 * The part of the incoming metadata this run owns outright, as an object to
 * merge over whatever the guards above decided (#571).
 *
 * `$16` is `SYNC_OWNED_METADATA_KEYS`, bound rather than spelled into the
 * statement so the key list stays one constant and no SQL is assembled by
 * concatenation. `jsonb_object_agg` over an empty set is NULL, which is what the
 * COALESCE is for; the presence guard is what keeps a source that sends none of
 * these keys from writing a null-valued one into every row, since the aggregate
 * rejects a null key and accepts a null value.
 */
const SYNC_OWNED_SLICE = `COALESCE((
                 SELECT jsonb_object_agg(owned.k, EXCLUDED.metadata -> owned.k)
                 FROM unnest($16::text[]) AS owned(k)
                 WHERE EXCLUDED.metadata ? owned.k
               ), '{}'::jsonb)`;

/** Columns the diff reads. Declared once; the SQL below is built from them. */
const SNAPSHOT_COLUMNS = [
  'name', 'name_local', 'description', 'short_description', 'type', 'tags',
  'country_codes', 'country_names', 'image_url', 'metadata',
] as const;

function snapshotFromRow(row: Record<string, unknown>): ExperienceSnapshot {
  return {
    name: (row.name as string) ?? '',
    nameLocal: (row.name_local as Record<string, string> | null) ?? null,
    description: (row.description as string | null) ?? null,
    shortDescription: (row.short_description as string | null) ?? null,
    type: (row.type as string | null) ?? null,
    tags: (row.tags as string[] | null) ?? null,
    lon: Number(row.lon),
    lat: Number(row.lat),
    countryCodes: (row.country_codes as string[] | null) ?? null,
    countryNames: (row.country_names as string[] | null) ?? null,
    imageUrl: (row.image_url as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

function snapshotFromParams(params: ExperienceUpsertParams): ExperienceSnapshot {
  return {
    name: params.name,
    nameLocal: params.nameLocal,
    description: params.description,
    shortDescription: params.shortDescription,
    type: params.type,
    tags: params.tags,
    lon: params.lon,
    lat: params.lat,
    countryCodes: params.countryCodes,
    countryNames: params.countryNames,
    imageUrl: params.imageUrl,
    metadata: params.metadata,
  };
}

/**
 * Read the stored row and diff it against the incoming record without writing.
 *
 * Backs dry runs: a preview has to be able to say what would change without
 * spending the change.
 */
async function previewUpsert(params: ExperienceUpsertParams): Promise<UpsertOutcome> {
  const result = await pool.query(
    `SELECT id, curated_fields, missing_since, source_membership,
            ${PREVIEW_HELD} AS was_held,
            ${SNAPSHOT_COLUMNS.join(', ')},
            ST_X(location) AS lon, ST_Y(location) AS lat
     FROM experiences
     WHERE category_id = $1 AND external_id = $2`,
    [params.categoryId, params.externalId]
  );

  const incoming = snapshotFromParams(params);

  if (result.rows.length === 0) {
    return {
      experienceId: 0,
      // No stored row, so nothing to hold: the insert writes every column, and
      // `pending` is what the gate does about a new membership.
      changeSet: computeChangeSet(null, incoming, [], false),
      nameSnapshot: params.name,
      returnedFromMissing: false,
    };
  }

  const row = result.rows[0];
  const curatedFields: string[] = row.curated_fields ?? [];

  // What the run this preview stands in for would refuse to write, asked of the
  // same expression that run's own guards are built from. Asked at all because
  // the whole point of a preview is to say what that run would do, and a preview
  // reporting a rename the run would refuse would mislabel it in the one
  // direction that matters.
  const heldFromView = Boolean(row.was_held);

  return {
    experienceId: row.id,
    // The change set still reports what the source proposes, held or not: under
    // a gate the proposal is what a curator is being asked about, so a preview
    // that reported "nothing would change" would hide the question. The hold
    // rides along so it lands in the bucket that says it was refused.
    changeSet: computeChangeSet(snapshotFromRow(row), incoming, curatedFields, heldFromView),
    nameSnapshot: curatedFields.includes('name') || heldFromView
      ? (row.name as string)
      : params.name,
    returnedFromMissing: row.missing_since !== null || row.source_membership === 'former',
  };
}

/**
 * What a run may put in `image_url`, asked of every source in one place.
 *
 * A run writes this column through no request schema at all — the rule a
 * curator's edit is held to never sees it — which is how 1260 rows came to
 * carry `whc.unesco.org/document/<id>`, a picture the World Heritage Centre's
 * terms do not let this product show, stored because the source called the
 * field an image and nothing asked ([ADR-0043](../../../../docs/decisions/0043-a-picture-we-show-is-one-we-may-show.md),
 * #557). Here rather than in each collector, for the same reason the invalidation
 * rule sits with the writer (#679): three sources write pictures, and a check
 * copied into each is a check one of them will be missing.
 *
 * The rule is the run's, `isCommonsPictureUrl`, and not the wider one a curator's
 * edit is held to: a source's picture is a Commons file by construction, and the
 * only writer of a `/images/…` path is a person, so a run offering one is
 * refused here as a source that started answering with something else would be.
 *
 * The credit is not decided here. `creditToWrite` (`imageCredit.ts`), which
 * every collector goes through, already treats a picture the run may not write
 * as no picture — so an unclaimed row arrives with no credit for it, and a
 * *claimed* row arrives with the credit of the curator's own photograph, resent
 * on purpose. Deleting the key here would turn that resend into a removal the
 * change set reports on every run, for a photograph the row keeps; the
 * statement below re-applies a claimed picture's stored credit as well, so the
 * column cannot lose it whatever the params say.
 *
 * Refusing is deliberately quiet in the report and loud in the log: the run's
 * counters are about rows, and a row whose picture was refused is still a row
 * the source offered and the catalogue holds. What says it out loud is the
 * picture's absence on the card, which is the honest thing for a picture the
 * product may not draw.
 */
function withShowablePicture(params: ExperienceUpsertParams): ExperienceUpsertParams {
  if (!params.imageUrl || isCommonsPictureUrl(params.imageUrl)) return params;
  console.warn(
    `[Sync] Refused a picture for ${params.categoryId}/${params.externalId}: ${params.imageUrl}`,
  );
  return { ...params, imageUrl: null };
}

/**
 * The names a run offers, as a person would type them (`tidyLabel`, #835).
 *
 * Here rather than in each collector, for the reason the picture rule is: three
 * sources write a name, every one of them reads it off a label service that
 * passes runs of whitespace through, and a rule copied into each is a rule one
 * of them will be missing. The place's own name, every language of its local
 * names, and the set-valued metadata lists that hold people's names — public
 * art's `creators` — are the strings a reader types into a filter. Before the
 * diff as well as the write, so a run compares tidied to tidied and never
 * reports a rename it only tidied.
 */
function withTidyNames(params: ExperienceUpsertParams): ExperienceUpsertParams {
  const nameLocal = Object.fromEntries(
    Object.entries(params.nameLocal).map(([language, name]) => [language, tidyLabel(name)]),
  );
  const metadata = { ...params.metadata };
  for (const key of METADATA_SET_KEYS) {
    const names = metadata[key];
    if (Array.isArray(names)) {
      metadata[key] = names.map(name => (typeof name === 'string' ? tidyLabel(name) : name));
    }
  }
  return { ...params, name: tidyLabel(params.name), nameLocal, metadata };
}

/**
 * Upsert an experience record and its membership with curated_fields-aware
 * conflict handling, returning both the prior and resulting state.
 *
 * One transaction per object, locking the row first — the header says why.
 * The `before` snapshot is the locked read, so what the diff compares against
 * is the row as it stood when the hold was decided, and nothing can land
 * between the two.
 */
export async function upsertExperienceRecord(
  rawParams: ExperienceUpsertParams,
  options: { dryRun?: boolean; syncLogId?: number | null } = {},
): Promise<UpsertOutcome> {
  // Before the dry-run branch, so a preview says what the run would do rather
  // than what the source proposed.
  const params = withShowablePicture(withTidyNames(rawParams));
  if (options.dryRun) return previewUpsert(params);

  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const outcome = await writeUnderLock(client, params, options.syncLogId ?? null);
    await client.query('COMMIT');
    return outcome;
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled: it
    // would otherwise carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

async function writeUnderLock(
  client: PoolClient,
  params: ExperienceUpsertParams,
  syncLogId: number | null,
): Promise<UpsertOutcome> {
  // The lock first, in a statement of its own — the mode every curator write
  // takes on the same row. A place the run has not created yet locks nothing
  // and holds nothing: the insert writes every column.
  const locked = await client.query(
    `SELECT id FROM experiences WHERE category_id = $1 AND external_id = $2 ${OBJECT_LOCK}`,
    [params.categoryId, params.externalId],
  );
  // The row as it stands under that lock, and the hold decided on the same
  // snapshot. A second statement rather than columns of the locking one: a
  // statement's snapshot is taken before it waits for the lock, and once the
  // lock is granted only the locked row is re-read — the memberships the hold
  // asks about would still read as they stood before a publish that committed
  // during the wait (`db/locks.ts`). This statement starts with the lock held,
  // so its snapshot has that publish in it.
  const stored = locked.rows.length === 0 ? null : (await client.query(
    `SELECT e.id, e.curated_fields, e.missing_since, e.source_membership,
            ${SNAPSHOT_COLUMNS.map(column => `e.${column}`).join(', ')},
            ST_X(e.location) AS lon, ST_Y(e.location) AS lat,
            ${LOCKED_HELD} AS was_held
       FROM experiences e
      WHERE e.category_id = $1 AND e.external_id = $2`,
    [params.categoryId, params.externalId],
  )).rows[0] ?? null;
  const held = Boolean(stored?.was_held);

  const result = await client.query(
    `WITH gate AS (
      SELECT requires_curation FROM experience_categories WHERE id = $1
    ), hold AS (
      SELECT $17::boolean AS held
    ), ins AS (
      INSERT INTO experiences (
        category_id, external_id, name, name_local, description, short_description,
        type, tags, location, country_codes, country_names, image_url, metadata,
        first_seen_sync_log_id, last_seen_sync_log_id, last_seen_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        ST_SetSRID(ST_MakePoint($9, $10), 4326),
        $11, $12, $13, $14, $15, $15, NOW(), NOW(), NOW()
      )
      ON CONFLICT (category_id, external_id) DO UPDATE SET
        name = CASE WHEN experiences.curated_fields ? 'name' OR ${HELD} THEN experiences.name ELSE EXCLUDED.name END,
        name_local = CASE WHEN experiences.curated_fields ? 'name_local' OR ${HELD} THEN experiences.name_local ELSE EXCLUDED.name_local END,
        description = CASE WHEN experiences.curated_fields ? 'description' OR ${HELD} THEN experiences.description ELSE EXCLUDED.description END,
        short_description = CASE WHEN experiences.curated_fields ? 'short_description' OR ${HELD} THEN experiences.short_description ELSE EXCLUDED.short_description END,
        type = CASE WHEN experiences.curated_fields ? 'type' OR ${HELD} THEN experiences.type ELSE EXCLUDED.type END,
        -- Behind a claim but not behind the gate. Tags are labels the import
        -- derives from facts it also stores by name -- the criteria, the danger
        -- listing, the landmark's type -- and no reader-facing read returns
        -- them (the by-id read did, rendered by nothing, until #570 took the
        -- column out of it), so there is nothing a reader can already see for
        -- the gate to protect (#570, the rule #571 stated: a person is asked only about
        -- what a reader can eventually see). Held, they filed 3785 rows in
        -- this database's log that restated the row beside them. A claim still
        -- holds, unlike the run-owned counters in metadata: a curator can set
        -- tags through the edit endpoint, and a person's deliberate write is
        -- not a measurement the run can be right about. computeChangeSet
        -- reports tags nowhere, so nothing written here waits on anybody.
        -- One consequence is owned rather than hidden: the in_danger tag now
        -- moves ahead of the metadata flag it mirrors while that flag is
        -- held, and the Catalogue Check comparing the two leaves out a row
        -- whose held proposal holds the flag itself.
        tags = CASE WHEN experiences.curated_fields ? 'tags' THEN experiences.tags ELSE EXCLUDED.tags END,
        location = CASE WHEN experiences.curated_fields ? 'location' OR ${HELD} THEN experiences.location ELSE EXCLUDED.location END,
        country_codes = CASE WHEN experiences.curated_fields ? 'country_codes' OR ${HELD} THEN experiences.country_codes ELSE EXCLUDED.country_codes END,
        country_names = CASE WHEN experiences.curated_fields ? 'country_names' OR ${HELD} THEN experiences.country_names ELSE EXCLUDED.country_names END,
        image_url = CASE WHEN experiences.curated_fields ? 'image_url' OR ${HELD} THEN experiences.image_url ELSE EXCLUDED.image_url END,
        -- Two claim shapes reach this column, and only one of them used to work.
        -- editExperience claims per key -- 'metadata.website',
        -- 'metadata.wikipediaUrl' -- and ? 'metadata' is false for those, so
        -- the guard never fired and EXCLUDED replaced the object, curator's link
        -- included (#488). A claim on 'metadata' itself still holds the whole
        -- column; a per-key claim now re-applies just those keys over whatever
        -- the source sent, so an unclaimed key still updates.
        --
        -- The keys a run computes about its own pass stand outside both guards:
        -- a claim cannot hold them because nobody can be right about a
        -- measurement, and the gate does not hold them because they are not
        -- content a reader sees. That is the standing last_seen_at has here,
        -- and the one the treasures upsert gives sitelinks_count. Refusing them
        -- froze the Louvre's stored fame sum at the value it had when the gate
        -- went up, while every run went on asking a curator about the difference
        -- (#571). Each arm reaches that its own way: the refusing arm merges the
        -- slice over the stored object, and the writing arm has it already,
        -- inside the source's own object, provided the claimed-key
        -- re-application below leaves it alone. computeChangeSet keeps the
        -- identical keys out of the diff, so nothing written here is reported as
        -- a change or waits on anybody.
        metadata = CASE
          WHEN experiences.curated_fields ? 'metadata' OR ${HELD}
            THEN COALESCE(experiences.metadata, '{}'::jsonb) || ${SYNC_OWNED_SLICE}
          -- No credit beside no picture, whatever the params say: a run's
          -- credit is decided by creditToWrite, which sends none for a picture
          -- it may not write, and this is the column holding that line for a
          -- collector that did not go through it. A claimed picture's credit is
          -- put back by the last arm, since the claimed picture stays.
          ELSE (CASE WHEN EXCLUDED.image_url IS NULL
                     THEN COALESCE(EXCLUDED.metadata, '{}'::jsonb) - 'imageCredit'
                     ELSE COALESCE(EXCLUDED.metadata, '{}'::jsonb) END) || COALESCE((
                 SELECT jsonb_object_agg(claimed.k, experiences.metadata -> claimed.k)
                 FROM (
                   SELECT substring(key FROM ${METADATA_CLAIM_PREFIX.length + 1}) AS k
                   FROM jsonb_array_elements_text(experiences.curated_fields) AS t(key)
                   WHERE key LIKE '${METADATA_CLAIM_PREFIX}%'
                 ) AS claimed
                 -- The exclusion claimedMetadataKeys applies on the other side.
                 -- Re-applying a claimed counter here would put the stored value
                 -- back over the source's while the diff reported neither, and
                 -- the row would keep a number no run could ever correct.
                 WHERE experiences.metadata ? claimed.k
                   AND claimed.k <> ALL($16::text[])
               ), '{}'::jsonb)
               -- The credit follows the picture, and a claimed picture is the
               -- curator's: whatever a run says about who took a photograph, the
               -- row keeps the name under the one the curator chose. creditToWrite
               -- resends the stored credit for that case in TypeScript, from a
               -- claim set read before the collection; this is the same rule
               -- where the column is written, so a claim made while the run was
               -- collecting — which that snapshot cannot see — still keeps its
               -- credit, as the treasures upsert keeps a work's for the same window.
               || CASE WHEN experiences.curated_fields ? 'image_url'
                        AND experiences.metadata ? 'imageCredit'
                       THEN jsonb_build_object('imageCredit', experiences.metadata -> 'imageCredit')
                       ELSE '{}'::jsonb END
        END,
        last_seen_sync_log_id = COALESCE(EXCLUDED.last_seen_sync_log_id, experiences.last_seen_sync_log_id),
        last_seen_at = NOW(),
        missing_since = NULL,
        -- The source listing a row is evidence about membership, exactly as
        -- its absence was. A curator's 'former' was a claim about the source's
        -- collection, and the source has just contradicted it; leaving it
        -- would mark as delisted an object the source currently offers, with
        -- nothing anywhere to say so. Existence is untouched: a listing says
        -- nothing about whether the thing still stands. Only ever toward more
        -- visibility, so a source outage still cannot hide anything (ADR-0020).
        source_membership = 'present',
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS inserted, curated_fields,
                ${SNAPSHOT_COLUMNS.join(', ')},
                ST_X(location) AS lon, ST_Y(location) AS lat
    ), membership AS (
      -- The place's membership in the kind this source fills (ADR-0045
      -- decision 4). A new place arrives with its gate state: a gated source's
      -- arrival waits for a person, a trusted source's is live the moment it
      -- lands and says so (ADR-0025) -- read from the source rather than
      -- passed in, so the check and the write cannot disagree. An existing
      -- membership keeps its state and its badge -- publishing is a curator's
      -- act, the badge is the admission step's -- and takes the run's own
      -- bookkeeping. The pointer says which run's proposal is being held; this
      -- statement can only ever clear it, since whether a proposal exists is a
      -- question about whether anything differs and the CASE arms above fire
      -- either way. Setting it is done after this statement, and only for a
      -- run that proposed something.
      INSERT INTO ${MEMBERSHIPS} (
        experience_id, kind_id, source_id, admitted_for, curation_state, published_at
      )
      SELECT ins.id,
             (SELECT kind_id FROM experience_categories WHERE id = $1),
             $1,
             $18::jsonb,
             CASE WHEN (SELECT requires_curation FROM gate) THEN 'pending' ELSE 'auto' END,
             CASE WHEN (SELECT requires_curation FROM gate) THEN NULL ELSE NOW() END
        FROM ins
      ON CONFLICT (experience_id, kind_id) DO UPDATE SET
        admitted_for = EXCLUDED.admitted_for,
        pending_change_sync_log_id = CASE WHEN ${HELD}
                                         THEN ${MEMBERSHIPS}.pending_change_sync_log_id
                                         ELSE NULL END,
        updated_at = NOW()
      RETURNING pending_change_sync_log_id
    )
    SELECT ins.*, membership.pending_change_sync_log_id
    FROM ins, membership`,
    [
      params.categoryId,
      params.externalId,
      params.name,
      JSON.stringify(params.nameLocal),
      params.description,
      params.shortDescription,
      params.type,
      JSON.stringify(params.tags),
      params.lon,
      params.lat,
      params.countryCodes,
      params.countryNames,
      params.imageUrl,
      JSON.stringify(params.metadata),
      syncLogId,
      // The key list the metadata arms read twice, bound once. A text[] rather
      // than a literal built into the statement, so the constant in
      // `changeSet.ts` stays the only place these names are written down.
      [...SYNC_OWNED_METADATA_KEYS],
      held,
      params.admittedFor ? JSON.stringify(params.admittedFor) : null,
    ]
  );

  const row = result.rows[0];
  const before = stored && !row.inserted ? snapshotFromRow(stored) : null;
  const changeSet = computeChangeSet(before, snapshotFromParams(params), row.curated_fields ?? [], held);

  // A curator's pass covered the object that was there; a changed object has not
  // been passed (ADR-0025). Resolved here rather than in SQL because the
  // statement cannot tell a content change from a provenance-only pass — its
  // CASE guards fire either way — and resolved inside this function rather than
  // in the three sync services, which would be three places to forget.
  //
  // Only a **trusted** source's change retires a pass, and the reason is the
  // hold above: under a gated source the changed values were not written, so
  // what a reader sees is still exactly what the curator passed. Decaying there
  // would retire a pass over a change the same statement had just refused to
  // apply, on every run, for as long as the proposal went unanswered. Two things
  // now say so — the change set files those values as held rather than changed,
  // so `wroteContent` is false and no statement is even sent, and the statement
  // carries the gate check itself for the case where something did get written.
  //
  // Scoped to `verified` so it can only ever move one way. A `pending`
  // membership is untouched: it is not published, so there is nothing to decay.
  //
  // Its own statement, so a failure here throws after the content is already
  // written and the run reports that object as failed — the transaction rolls
  // the content back with it. Deliberate: the alternative is to swallow the
  // error, which leaves a membership saying `verified` about content nobody
  // passed, and the next run finds nothing changed and so never decays it.
  //
  // Fields this statement actually wrote, which is now exactly what
  // `changedFields` holds: `computeChangeSet` files a refused write under the
  // reason it was refused instead (#519). So the decay below stays keyed to
  // written content without having to subtract anything.
  const wroteContent = changeSet.changedFields.length > 0;
  // The pointer follows every proposal this statement refused, not only the ones
  // it wrote — and both kinds of refusal are proposals. A field a curator claimed
  // lands in `curatedConflicts`, a field the gate held in `heldFields`, and
  // either way `changedFields` is empty; keying the pointer on that alone would
  // clear it on a run whose proposal is still standing and still unanswered —
  // "nothing is held" about a row that is holding something, and about the
  // gate-held case that is the whole reason the pointer exists. `significance` in
  // `changeSet.ts` weighs all three buckets for the same reason: the refused half
  // is the half needing a decision, so it cannot be the hidden one.
  const proposedAnything = wroteContent
    || changeSet.curatedConflicts.length > 0
    || changeSet.heldFields.length > 0;

  if (wroteContent) {
    await client.query(
      `UPDATE ${MEMBERSHIPS} m SET curation_state = 'auto', updated_at = NOW()
        WHERE m.experience_id = $1 AND m.source_id = $2
          AND m.curation_state = 'verified'
          AND NOT EXISTS (
            SELECT 1 FROM experience_categories
             WHERE id = $2 AND requires_curation
          )`,
      [row.id, params.categoryId],
    );
  }

  if (proposedAnything) {
    // And the mirror image of the decay: where the source IS gated and the place
    // was visible, the statement above kept the stored content and this run's
    // proposal is what a curator will be shown, so the membership points at this
    // run. Only here, because only here is it known that something was actually
    // proposed — the upsert cannot tell a content change from a pass that
    // touched nothing, and a pointer set on every pass would tell a curator that
    // 1200 rows were waiting on a decision when none of them were.
    //
    // The statement is shared with the two content writers, which set the same
    // pointer for a held field of a point or a work (ADR-0037); the predicate —
    // a visible membership of the run's own source, under a gate, and never
    // from a run with no log id — lives there so the three cannot drift.
    await pointHeldProposalAt(client, row.id as number, syncLogId);
  } else if (row.pending_change_sync_log_id !== null) {
    // The complement, and the reason the column can be trusted to mean what its
    // comment says. A run that proposed nothing at all — nothing written and
    // nothing refused — has nothing held: the source has come back to what is
    // stored, so a pointer left in place would name a proposal that no longer
    // exists, a decision waiting on a curator's screen that the source has
    // already withdrawn. Only reached when the membership actually carries a
    // pointer, which is why the upsert returns it: otherwise every unchanged
    // row in every run would spend a statement on this.
    await client.query(
      `UPDATE ${MEMBERSHIPS} m SET pending_change_sync_log_id = NULL, updated_at = NOW()
        WHERE m.experience_id = $1 AND m.source_id = $2
          AND m.curation_state <> 'pending'
          AND EXISTS (
            SELECT 1 FROM experience_categories
             WHERE id = $2 AND requires_curation
          )`,
      [row.id, params.categoryId],
    );
  }

  return {
    experienceId: row.id,
    changeSet,
    // RETURNING carries the name after the curated_fields guards, so a
    // protected name labels the changeset row with what is actually stored.
    nameSnapshot: (row.name as string) ?? params.name,
    // A curator's verdict takes the row out of `missing_since`, so the flag
    // alone would miss the return of an object someone had already called
    // former — which is the only reason it stopped being flagged.
    returnedFromMissing: stored != null
      && (stored.missing_since != null || stored.source_membership === 'former'),
  };
}
