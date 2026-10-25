/**
 * The curator's writes to `experiences`, and the object lock every writer takes
 * (ADR-0069, #791).
 *
 * The table's writers are a closed list the backend lint names
 * (`EXPERIENCE_WRITE_RULES`): this module, the run's upsert
 * (`services/sync/experienceUpsert.ts`), missing detection's mark and the
 * picture repair, and the seed. Every curator write is a named function here;
 * the statement and what it does live here, and whether to issue it — the
 * verdict, the claim, the held proposal — stays with the caller that decided it.
 *
 * **A write that assumes the object's lock takes the lock.** `lockExperience`
 * runs `OBJECT_LOCK` (`db/locks.ts`) on the caller's connection and hands back a
 * `LockedExperience`, which nothing outside this module produces; every write
 * made under that lock requires one, so a write issued before the lock, or on a
 * path that never took it, does not type-check. The curator's writes to the
 * object's points and to its works take it too
 * (`controllers/experience/experienceLocationWriter.ts`,
 * `controllers/experience/workWriter.ts`), so for a point and a work alike "the
 * object first" is a property of the types.
 *
 * A write outside the lock rule takes no token, and `db/locks.ts` names why.
 */

import type { PoolClient } from 'pg';
import { OBJECT_LOCK } from './locks.js';
import { DESCRIPTION_SOURCE_ID, MEMBERSHIPS } from './membership.js';
import { offeredLocationSql, publishedContentSql } from './readerPredicates.js';
import { shownBySql } from './placePoints.js';

declare const locked: unique symbol;

/**
 * Proof that this transaction holds the object's row lock, on the connection it
 * runs on. Produced only in this module: by `lockExperience`,
 * `lockSourcedExperience`, `lockIdentifiedPlace`, and `insertCuratedExperience`,
 * whose insert's own row lock is the object lock.
 */
export type LockedExperience = { readonly id: number; readonly [locked]: true };

/**
 * Lock the object, in a statement of its own, and read `columns` of it.
 *
 * `columns` is a select list of the row's own columns — they are re-read at
 * their latest version once the lock is granted, so reading them here is
 * fresh. A column of another table (a membership, a point) is not: `db/locks.ts`
 * § the snapshot says why, and that read belongs in the next statement.
 *
 * Null where the row is gone: a handler's existence check ran earlier, on
 * another connection, and a row deleted in between leaves nothing to lock.
 */
export async function lockExperience<Row extends Record<string, unknown> = { id: number }>(
  client: PoolClient,
  experienceId: number,
  columns = 'id',
): Promise<{ lock: LockedExperience; row: Row } | null> {
  const result = await client.query(
    `SELECT ${columns} FROM experiences WHERE id = $1 ${OBJECT_LOCK}`,
    [experienceId],
  );
  if (result.rows.length === 0) return null;
  return { lock: { id: experienceId } as LockedExperience, row: result.rows[0] as Row };
}

/**
 * Two places' object locks for a merge or its undo (ADR-0086 decision 6): the
 * lower id first, so two merges over the same pair cannot each hold one and
 * wait for the other, then the contents, as `db/locks.ts` orders one object.
 * Null where either place is gone. Each row carries `merged_into_id`, which a
 * merge and its undo both check under the lock.
 */
export async function lockTwoExperiences(
  client: PoolClient,
  first: number,
  second: number,
): Promise<Map<number, { lock: LockedExperience; mergedInto: number | null }> | null> {
  const locked = new Map<number, { lock: LockedExperience; mergedInto: number | null }>();
  for (const id of [Math.min(first, second), Math.max(first, second)]) {
    const result = await lockExperience<{ merged_into_id: number | null }>(client, id, 'merged_into_id');
    if (!result) return null;
    locked.set(id, { lock: result.lock, mergedInto: result.row.merged_into_id });
  }
  return locked;
}

/**
 * Mark a place folded into another (ADR-0086 decision 1), or, with null, take
 * the mark back on an undo. The place is kept: its history, its visits and its
 * address stay, and it offers nothing because it keeps no membership.
 */
export async function markFolded(client: PoolClient, folded: LockedExperience, into: number | null): Promise<void> {
  await client.query('UPDATE experiences SET merged_into_id = $2, updated_at = NOW() WHERE id = $1', [folded.id, into]);
}

/**
 * The same lock, found by the source's own name for the object — what a run
 * knows before it knows the id — through the source's membership (ADR-0084:
 * a place belongs to no source, so the place's own `source_id` is not the
 * key). Null where the source is offering it for the first time: there is no
 * row yet, and the insert's own row lock is the object lock (`db/locks.ts`).
 *
 * The membership is read again once the lock is held. The first statement
 * chose the place under the snapshot it took before waiting, so a membership
 * a merge moved to another place during that wait would leave the run holding
 * the place it was moved from; the re-read names the place it hangs on now,
 * and the lock is taken there instead.
 *
 * The source's name for the object is locked first, for the transaction
 * (`pg_advisory_xact_lock`): where there is no place yet there is no row to
 * lock, and two writers offering the same new object — two processes, which
 * the in-memory `runningSyncs` guard cannot see — would both find nothing and
 * both insert, the second refused by the place's own unique pair. With the
 * name locked, the second waits, then finds the membership the first wrote.
 * Nothing else takes this lock, so it is always taken before the row's.
 */
export async function lockSourcedExperience(
  client: PoolClient,
  sourceId: number,
  externalId: string,
): Promise<(LockedExperience & { redirectedFrom?: string }) | null> {
  // The run's own id first; then, for a Wikidata source reading an item, the
  // membership keyed by an item Wikidata has since redirected to it (ADR-0143
  // decision 3, #1895): the place is the same, under the id the source knew it
  // by before the merge on Wikidata. The upsert moves the membership's key to
  // the item the run reads, under the lock this takes.
  const placeOf = async (): Promise<{ id: number; from: string } | undefined> => (await client.query<{ id: number; from: string }>(
    `SELECT m.experience_id AS id, m.external_id AS "from" FROM ${MEMBERSHIPS} m
      WHERE m.source_id = $1
        AND (m.external_id = $2
             OR m.external_id IN (SELECT r.source FROM workbench.wikidata_redirects r WHERE r.target = $2))
      ORDER BY (m.external_id = $2) DESC, m.id
      LIMIT 1`,
    [sourceId, externalId],
  )).rows[0];

  await client.query('SELECT pg_advisory_xact_lock($1::integer, hashtext($2))', [sourceId, externalId]);
  let found = await placeOf();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (found === undefined) return null;
    await client.query(`SELECT id FROM experiences WHERE id = $1 ${OBJECT_LOCK}`, [found.id]);
    const now = await placeOf();
    if (now?.id === found.id) {
      return { id: found.id, ...(found.from === externalId ? {} : { redirectedFrom: found.from }) } as LockedExperience & { redirectedFrom?: string };
    }
    found = now;
  }
  throw new Error(`${sourceId}/${externalId} kept moving between places while a run locked it`);
}

/**
 * `items` with every item Wikidata redirected to or from one of them (ADR-0143
 * decision 3, #1895), as the kept redirects say (`wikidata-redirects`, a
 * keeper of the dumps panel): a place registered under an item Wikidata has
 * since merged into another is found by the item a run reads now, and one
 * registered under the target is found by a stale source. Nothing while no
 * build is in place.
 */
export async function withRedirects(client: Pick<PoolClient, 'query'>, items: readonly string[]): Promise<string[]> {
  if (items.length === 0) return [];
  const rows = await client.query<{ item: string }>(
    `SELECT r.source AS item FROM workbench.wikidata_redirects r WHERE r.target = ANY($1::text[])
     UNION
     SELECT r.target FROM workbench.wikidata_redirects r WHERE r.source = ANY($1::text[])`,
    [items],
  );
  return [...new Set([...items, ...rows.rows.map(row => row.item)])];
}

/**
 * The live place a Wikidata item identifies, locked, for a run whose own
 * membership found nothing (ADR-0143 decision 3, #1894): the place the run
 * joins instead of creating one. `null` when no place is identified by any of
 * `items` and holds no membership in the run's kind yet, and the items' keys
 * are then held (`lock_place_identifiers`), so a second writer of the same new
 * item waits for this transaction's place and then finds it.
 *
 * Only an identifying row is followed (`place_identifiers.identifies`): an item
 * a serial site's parts all carry refers to them, and an item two places claim
 * identifies neither until a person settles it. A place that already holds a
 * membership in the run's kind is not joined, since a place holds one
 * membership per kind; the run creates its own and the catalogue check lists
 * the item.
 *
 * The items are widened to those Wikidata redirected to or from them
 * (`withRedirects`, #1895) before anything is looked up.
 *
 * Looked up first without the keys, and the place locked as any writer locks
 * it, row before keys. Only a first read that found nothing takes the keys and
 * reads again; where that second read finds a place another run created
 * meanwhile, the row is locked after the keys, and a writer of that place
 * waiting on the same keys meets this run in a cycle, which PostgreSQL ends by
 * aborting one (40P01). The run records that item as failed and its next run
 * writes it. Read again once the row is locked, since a merge or an edit
 * during the wait may have moved the item to another place.
 */
export async function lockIdentifiedPlace(
  client: PoolClient,
  sourceId: number,
  candidateItems: readonly string[],
): Promise<LockedExperience | null> {
  const items = await withRedirects(client, candidateItems);
  if (items.length === 0) return null;
  const placeOf = async (): Promise<number | undefined> => (await client.query(
    `SELECT pi.experience_id FROM place_identifiers pi
      WHERE pi.scheme = 'wikidata' AND pi.value = ANY($1::text[]) AND pi.identifies
        AND NOT EXISTS (SELECT 1 FROM ${MEMBERSHIPS} own
                         WHERE own.experience_id = pi.experience_id
                           AND own.kind_id = (SELECT kind_id FROM experience_sources WHERE id = $2))
      ORDER BY pi.experience_id
      LIMIT 1`,
    [items, sourceId],
  )).rows[0]?.experience_id as number | undefined;

  let id = await placeOf();
  let keysHeld = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (id === undefined) {
      if (keysHeld) return null;
      await client.query(`SELECT lock_place_identifiers('wikidata', $1::text[])`, [items]);
      keysHeld = true;
      id = await placeOf();
      continue;
    }
    await client.query(`SELECT id FROM experiences WHERE id = $1 ${OBJECT_LOCK}`, [id]);
    const now = await placeOf();
    if (now === id) return { id } as LockedExperience;
    id = now;
  }
  throw new Error(`${items.join(', ')} kept moving between places while a run locked it`);
}

/**
 * The object's own coordinate follows the one point a reader is positioned
 * over, and is claimed there (ADR-0028 decision 2, #550): what a curator's
 * correction of that point does to the object. Answers whether it moved.
 *
 * The statement decides whether this point is that one — the count and the
 * `EXISTS` below — so a caller hands over the edit and reads the answer rather
 * than deciding first. `locationEditController` says when a correction reaches
 * it at all.
 */
export async function anchorToItsPoint(
  client: PoolClient,
  lock: LockedExperience,
  longitude: number,
  latitude: number,
  locationId: number,
): Promise<boolean> {
  const anchored = await client.query(
    `UPDATE experiences e
        SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326),
            curated_fields = CASE WHEN e.curated_fields ? 'location'
                                  THEN e.curated_fields
                                  ELSE COALESCE(e.curated_fields, '[]'::jsonb) || '["location"]'::jsonb END,
            -- Stamped by hand like every other writer of this table: there is
            -- no trigger, and both columns above are ones a reader is served
            -- from, so a row left reporting the time of whatever last touched
            -- it would answer "last changed" with a moment before its
            -- coordinate moved.
            updated_at = NOW()
      WHERE e.id = $1
        -- Of every point the object shows, its parts' included (ADR-0100).
        AND (SELECT COUNT(*) FROM experience_locations el
              WHERE ${shownBySql('el', 'ARRAY[$1::int]')}
                AND ${offeredLocationSql('el')}
                AND ${publishedContentSql('el')}) = 1
        -- ...and it is *this* point. The count alone says the object has one
        -- place a reader is positioned over; it does not say the curator was
        -- editing that one. Editing a withdrawn, lost or unread sibling beside
        -- one visible point satisfies the count and would move the object onto
        -- a coordinate readerPositionSql never sends anyone to -- #550's
        -- disagreement, made by the endpoint written to close it. Two of those
        -- three shapes are reachable only since the count learned the
        -- fragments: under missing_since IS NULL alone a lost or unread
        -- sibling made the count 2 and nothing moved.
        AND EXISTS (SELECT 1 FROM experience_locations el
                     WHERE el.id = $4 AND ${shownBySql('el', 'ARRAY[$1::int]')}
                       AND ${offeredLocationSql('el')}
                       AND ${publishedContentSql('el')})
      RETURNING e.id`,
    [lock.id, longitude, latitude, locationId],
  );
  return anchored.rows.length > 0;
}

/**
 * Write columns a caller decided, under the lock: the curator's edit, an
 * accepted source value, a published held proposal.
 *
 * The caller owns which columns and what they are set to — each builds its
 * list from a claim set or a proposal this module has no business reading —
 * and this owns the rest of the statement: the row it names (`$1`, the locked
 * id) and the stamp. `params` bind `$2` onward, in the order the assignments
 * reference them.
 *
 * `updated_at` is stamped here because nothing else stamps it: the table has no
 * trigger, and a row read by readers that reports the time of whatever last
 * touched it answers "last changed" with the wrong moment.
 */
export async function updateExperienceColumns(
  client: PoolClient,
  lock: LockedExperience,
  assignments: readonly string[],
  params: readonly unknown[],
): Promise<void> {
  await client.query(
    `UPDATE experiences
     SET ${[...assignments, 'updated_at = NOW()'].join(',\n         ')}
     WHERE id = $1`,
    [lock.id, ...params],
  );
}

/**
 * Who decided about the place, when, and what they noted — the three columns
 * every curator verdict on the place shares (ADR-0020), written beside the
 * verdict itself: an admission answer or a curator's refusal, whose own columns
 * are the membership's (#822).
 */
export async function recordDecisionOnExperience(
  client: PoolClient,
  lock: LockedExperience,
  decidedBy: number,
  note: string | null,
): Promise<void> {
  await client.query(`
    UPDATE experiences
    SET state_decided_by = $2,
        state_decided_at = NOW(),
        state_note = $3,
        updated_at = NOW()
    WHERE id = $1
  `, [lock.id, decidedBy, note]);
}

/**
 * A lifecycle verdict on the place (ADR-0020, ADR-0021): whether it still
 * stands, with who decided. Whether its sources still list it is its
 * memberships' (ADR-0084) and is written beside this by `setListingVerdict`
 * (`membershipWriter.ts`), under the same lock.
 */
export async function setLifecycleVerdict(
  client: PoolClient,
  lock: LockedExperience,
  verdict: { existence: string; decidedBy: number; note: string | null },
): Promise<void> {
  await client.query(`
    UPDATE experiences
    SET existence = $2,
        state_decided_by = $3,
        state_decided_at = NOW(),
        state_note = $4,
        updated_at = NOW()
    WHERE id = $1
  `, [lock.id, verdict.existence, verdict.decidedBy, verdict.note]);
}

/**
 * A place a curator adds by hand, as `createManualExperience` builds it:
 * `is_manual`, owned by nobody's run, and `active` from the moment it exists.
 *
 * Answers with the object's token, because the insert's own row lock *is* the
 * object lock (`db/locks.ts`): no other transaction can hold a row of an object
 * that did not exist when it began. The caller's transaction goes on to write
 * the membership and the point under it.
 */
export async function insertCuratedExperience(
  client: PoolClient,
  row: {
    sourceId: number;
    externalId: string;
    name: unknown;
    description: unknown;
    longitude: unknown;
    latitude: unknown;
    imageUrl: unknown;
    tags: string | null;
    countryCodes: unknown[] | null;
    countryNames: unknown[] | null;
    metadata: string | null;
    createdBy: number;
  },
): Promise<LockedExperience> {
  const inserted = await client.query(`
    INSERT INTO experiences (
      source_id, external_id, name, description,
      location, image_url, tags, country_codes, country_names,
      metadata, is_manual, created_by, status, curated_fields
    ) VALUES (
      $1, $2, $3, $4,
      ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8, $9, $10,
      $11, true, $12, 'active',
      -- The curator wrote the description, so it is claimed from the start: a
      -- merge that later brings a source's membership here neither credits the
      -- text to that source nor lets its next run replace it (ADR-0149).
      CASE WHEN $4::text IS NOT NULL THEN '["description"]'::jsonb ELSE '[]'::jsonb END
    ) RETURNING id
  `, [
    row.sourceId, row.externalId, row.name, row.description,
    row.longitude, row.latitude, row.imageUrl, row.tags, row.countryCodes, row.countryNames,
    row.metadata, row.createdBy,
  ]);
  return { id: inserted.rows[0].id as number } as LockedExperience;
}

/**
 * Undoing a separation of the UNESCO membership brings its text back with it
 * (ADR-0149): the merge moves no content, so the description, its claim and
 * the two keys the separation took off the original return from the folded
 * place. Only where the separation moved the UNESCO membership, and the
 * original has no description of its own and now holds it.
 */
export async function returnSeparatedUnescoText(
  client: PoolClient,
  original: LockedExperience,
  folded: LockedExperience,
  separationId: number,
): Promise<void> {
  await client.query(
    `UPDATE experiences o
        SET description = f.description,
            curated_fields = (COALESCE(o.curated_fields, '[]'::jsonb) - 'description')
              || CASE WHEN COALESCE(f.curated_fields, '[]'::jsonb) ? 'description' THEN '["description"]'::jsonb ELSE '[]'::jsonb END,
            metadata = (COALESCE(o.metadata, '{}'::jsonb) - 'unesco' - 'descriptionAdaptedFrom')
              || jsonb_strip_nulls(jsonb_build_object('unesco', f.metadata -> 'unesco',
                                                      'descriptionAdaptedFrom', f.metadata -> 'descriptionAdaptedFrom'))
       FROM experiences f
      WHERE o.id = $1 AND f.id = $2 AND o.description IS NULL AND f.description IS NOT NULL
        AND EXISTS (SELECT 1 FROM ${MEMBERSHIPS} m WHERE m.experience_id = o.id AND m.source_id = $3)
        AND EXISTS (SELECT 1 FROM experience_separations s JOIN ${MEMBERSHIPS} sm ON sm.id = s.membership_id
                     WHERE s.id = $4 AND sm.source_id = $3)`,
    [original.id, folded.id, DESCRIPTION_SOURCE_ID, separationId],
  );
}

/**
 * A place UNESCO's membership leaves lets UNESCO's text go with it (ADR-0149):
 * it keeps a description only where a curator wrote it as their own, and
 * loses the mark and the curator's word on whose text it is. Called by the
 * separation and by the undo of the merge that had undone one.
 */
export async function releaseUnescoText(client: PoolClient, place: LockedExperience): Promise<void> {
  await client.query(
    `UPDATE experiences e
        SET description = CASE WHEN own.kept THEN e.description END,
            curated_fields = CASE WHEN own.kept THEN e.curated_fields
                                  ELSE COALESCE(e.curated_fields, '[]'::jsonb) - 'description' END,
            metadata = COALESCE(e.metadata, '{}'::jsonb) - 'unesco' - 'descriptionAdaptedFrom'
       FROM (SELECT p.id, COALESCE(p.curated_fields, '[]'::jsonb) ? 'description'
                          AND p.metadata->>'descriptionAdaptedFrom' IS NULL AS kept
               FROM experiences p WHERE p.id = $1) own
      WHERE e.id = own.id`,
    [place.id],
  );
}

/**
 * The place a curator's separation makes of one kind's membership (ADR-0144):
 * the original's content, under the membership's own view of the name, the
 * subtitle, the picture and its credit, and the point (`reported_*`), and the
 * membership's source and id. The source's next run writes the rest through
 * the usual rules, finding its membership on this place. The outline goes
 * with the membership whose source drew it (ADR-0146 decision 5): the new place
 * takes it and the original lets it go, with what OpenStreetMap said about it
 * (`metadata.osm`), since the drawer's run reaches only the place its
 * membership is on. UNESCO's text goes the same way (ADR-0149): the
 * description, its mark and the curator's word on it go with the UNESCO
 * membership, and the original keeps only a description a curator claimed as
 * their own. Answers with the object's token: the
 * insert's own row lock is the object lock, as for a curator's created place.
 */
export async function insertSeparatedExperience(
  client: PoolClient,
  original: LockedExperience,
  membershipId: number,
): Promise<LockedExperience> {
  const inserted = await client.query(`
    WITH next AS (SELECT nextval(pg_get_serial_sequence('experiences', 'id')) AS id)
    INSERT INTO experiences (
      id, source_id, external_id, name, name_local, subtitle, description, tags, location,
      country_codes, country_names, image_url, metadata, status, boundary, area_km2, boundary_source_id,
      curated_fields
    )
    SELECT next.id, m.source_id,
           -- Which source first brought a place, and under what id, is all
           -- these two say (ADR-0143 decision 6): the new place's pair is the
           -- membership's own where no place holds it. Where one does — the
           -- original, which keeps its own pair, or a place a merge folded, the
           -- place an undone separation of this membership made among them —
           -- this place is named after itself, a name no other place can take,
           -- and the check membership-source-disagrees-with-row knows that name.
           CASE WHEN EXISTS (SELECT 1 FROM experiences taken WHERE taken.source_id = m.source_id AND taken.external_id = m.external_id)
                THEN 'separated-' || next.id ELSE m.external_id END,
           COALESCE(m.reported_name, e.name), e.name_local,
           CASE WHEN m.reported_name IS NULL THEN e.subtitle ELSE m.reported_subtitle END,
           CASE WHEN m.source_id = $3 AND NOT (COALESCE(e.curated_fields, '[]'::jsonb) ? 'description' AND e.metadata->>'descriptionAdaptedFrom' IS NULL) THEN e.description END, e.tags, COALESCE(m.reported_location, e.location),
           e.country_codes, e.country_names,
           CASE WHEN m.reported_name IS NULL THEN e.image_url ELSE m.reported_image_url END,
           -- What OpenStreetMap said goes only with the outline it is about.
           (COALESCE(e.metadata, '{}'::jsonb) - 'imageCredit'
              - CASE WHEN e.boundary_source_id IS NOT DISTINCT FROM m.source_id THEN '' ELSE 'osm' END
              - CASE WHEN m.source_id = $3 THEN '{}'::text[] ELSE ARRAY['unesco', 'descriptionAdaptedFrom'] END)
             || CASE WHEN m.reported_name IS NULL THEN jsonb_strip_nulls(jsonb_build_object('imageCredit', e.metadata -> 'imageCredit'))
                     ELSE jsonb_strip_nulls(jsonb_build_object('imageCredit', m.reported_image_credit)) END,
           e.status,
           CASE WHEN e.boundary_source_id = m.source_id THEN e.boundary END,
           CASE WHEN e.boundary_source_id = m.source_id THEN e.area_km2 END,
           CASE WHEN e.boundary_source_id = m.source_id THEN m.source_id END,
           -- A curator's edit of UNESCO's text stays theirs on the place it
           -- goes to; a description a curator wrote as their own stays behind.
           CASE WHEN m.source_id = $3 AND COALESCE(e.curated_fields, '[]'::jsonb) ? 'description'
                     AND e.metadata->>'descriptionAdaptedFrom' IS NOT NULL
                THEN '["description"]'::jsonb ELSE '[]'::jsonb END
      FROM next, experiences e
      JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id AND m.id = $2
     WHERE e.id = $1
    RETURNING id, source_id
  `, [original.id, membershipId, DESCRIPTION_SOURCE_ID]);
  if (inserted.rows[0].source_id === DESCRIPTION_SOURCE_ID) await releaseUnescoText(client, original);
  await client.query(
    `UPDATE experiences e SET boundary = NULL, area_km2 = NULL, boundary_source_id = NULL,
            metadata = COALESCE(e.metadata, '{}'::jsonb) - 'osm'
       FROM ${MEMBERSHIPS} m
      WHERE e.id = $1 AND m.id = $2 AND e.boundary_source_id = m.source_id`,
    [original.id, membershipId],
  );
  return { id: inserted.rows[0].id as number } as LockedExperience;
}
