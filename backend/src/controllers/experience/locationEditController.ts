/**
 * A curator's correction to one point: what it is called, or where it is.
 *
 * The gate's third answer. Holding a coordinate for review while offering only
 * "take the source's point" and "keep the source's point" leaves a curator who
 * can see the pin is wrong with no way to say so — the dead end
 * `stage-1-curation-gate.md` § 4.6 named. Measured against the live source on
 * 2026-08-20, six components moved more than a kilometre in a fortnight and the
 * worst moved 2.0 km, which is a traveller standing in the wrong place.
 *
 * Its own file rather than a branch of `editExperience`, on the precedent of
 * `locationStateController.ts`: a different table, a different lock, and one
 * rule that has no counterpart on an object — the anchor, below.
 */

import { Response } from 'express';
import { pool, rollbackQuietly } from '../../db/index.js';
import { OBJECT_LOCK } from '../../db/locks.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import { offeredLocationSql, publishedContentSql } from './experienceLifecycle.js';
import { placeAfterRelease } from './publishContents.js';

/** What a curator may claim on a point — see `db/migrations/027`. */
type Claim = 'name' | 'location';

/** The claims this edit adds, kept in the order the column already holds. */
function withClaims(stored: string[], added: Claim[]): string[] {
  const next = new Set(stored);
  for (const claim of added) next.add(claim);
  return [...next];
}

export async function editLocation(req: AuthenticatedRequest, res: Response): Promise<void> {
  const locationId = parseInt(String(req.params.locationId));
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const { name, latitude, longitude } = req.body as
    { name?: string; latitude?: number; longitude?: number };
  const movesPoint = latitude !== undefined && longitude !== undefined;

  // The point carries no scope of its own: it is judged through the object
  // holding it, which is where the regions and the category live.
  const found = await pool.query(
    `SELECT el.experience_id, e.category_id
       FROM experience_locations el
       JOIN experiences e ON e.id = el.experience_id
      WHERE el.id = $1`,
    [locationId],
  );
  if (found.rows.length === 0) {
    res.status(404).json({ error: 'Location not found' });
    return;
  }
  const { experience_id: experienceId, category_id: categoryId } = found.rows[0];

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId as number, categoryId as number,
  );
  if (!permitted) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  const client = await pool.connect();
  let unusable: Error | undefined;
  let anchorMoved = false;
  try {
    await client.query('BEGIN');

    // **The object first, then the point** — `OBJECT_LOCK`'s rule (`db/locks.ts`),
    // which every transaction that locks a row of an object's contents follows,
    // the sync writer included since it opens with the same lock. The rule is
    // what makes the mode argument hold: taken in two orders, two writers on one
    // object close a cycle, and Postgres resolves a cycle by failing one of them
    // with a 500. Held for every edit rather than only the ones that reach the
    // anchor, so the order is a property of the file instead of one branch's.
    await client.query(`SELECT id FROM experiences WHERE id = $1 ${OBJECT_LOCK}`, [experienceId]);

    // Everything this transaction depends on, re-read under the lock: the claim
    // set it is about to add to, and the values the trail reports as `old`.
    //
    // The set is re-read under the lock because one path does take a key back
    // off `experience_locations.curated_fields`: `accept-source` releases
    // `location` on the point the object's anchor was taken from, together with
    // the object's own claim, since those two are one fact and releasing half of
    // it re-opens #550. That point can be this one — it is whichever pin sits on
    // the object's coordinate — so a release landing between an unlocked read and
    // this write would be undone by the rewrite below, re-claiming a coordinate
    // whose curator had just handed it back. Everything else that writes these
    // columns only adds.
    const locked = await client.query(
      `SELECT name, curated_fields,
              ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
         FROM experience_locations WHERE id = $1 FOR UPDATE`,
      [locationId],
    );
    const before = locked.rows[0] as
      { name: string | null; curated_fields: string[]; lat: number; lon: number } | undefined;
    if (!before) {
      unusable = await rollbackQuietly(client);
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    const claims: Claim[] = [];
    if (name !== undefined) claims.push('name');
    if (movesPoint) claims.push('location');

    await client.query(
      `UPDATE experience_locations
          SET name = COALESCE($2, name),
              location = CASE WHEN $3::boolean
                              THEN ST_SetSRID(ST_MakePoint($4, $5), 4326)
                              ELSE location END,
              curated_fields = $6::jsonb
        WHERE id = $1`,
      [locationId, name ?? null, movesPoint, longitude ?? null, latitude ?? null,
        JSON.stringify(withClaims(before.curated_fields ?? [], claims))],
    );

    // **The anchor goes with the point, where there is only one point.**
    //
    // ADR-0028 positions a reader at the place nearest the object's published
    // coordinate, so with one place the reader already follows this edit. What
    // stays behind is the object's own coordinate, and the two disagreeing is
    // the data-quality signal #550 is about — measured at 106 objects and 191 km
    // at its worst, all of them UNESCO. Claimed on the experience as well, or
    // the next run writes the source's anchor back and re-opens the gap.
    //
    // Only where the object has exactly one point a reader is actually positioned
    // over, and the fragments say which rows those are rather than half of it
    // spelled out here. `missing_since IS NULL` alone counts two shapes this
    // writer is known to produce — a visible point beside one a curator declared
    // `lost` (the resurrection arm clears the flag and leaves `existence` alone),
    // and a visible point beside an unread arrival — and on either of them the
    // count comes to two, the anchor silently stays behind, and the reader follows
    // the edit while the object's own coordinate does not. Which is #550's
    // disagreement, reintroduced on the narrower shape this rule exists to close.
    //
    // With several such points the anchor is a fact about the object rather than
    // about any one of them, and nothing here knows which the curator meant.
    //
    // The consequence worth naming rather than discovering: a gated arrival's only
    // point is `pending`, so correcting it moves nothing, and the object's own
    // coordinate stays the source's until someone publishes it. That is the same
    // rule read consistently — the anchor follows what a reader is positioned over,
    // and a reader is positioned over nothing here yet — and the publication is
    // where the two can be brought together if it ever needs to be.
    if (movesPoint) {
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
            AND (SELECT COUNT(*) FROM experience_locations el
                  WHERE el.experience_id = e.id
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
                         WHERE el.id = $4 AND el.experience_id = e.id
                           AND ${offeredLocationSql('el')}
                           AND ${publishedContentSql('el')})
          RETURNING e.id`,
        [experienceId, longitude, latitude, locationId],
      );
      anchorMoved = anchored.rows.length > 0;
    }

    await client.query(
      `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
       VALUES ($1, $2, 'location_edited', $3, $4)`,
      // Only the keys this edit actually changed. The queue's claim attribution
      // asks `details ? '<column>'` to find who claimed a field, so a key present
      // and null would make a rename answer for the coordinate — the attribution
      // would name a curator who never touched it.
      [experienceId, userId, logRegionId, JSON.stringify({
        locationId,
        ...(name === undefined ? {} : { name: { old: before.name, new: name } }),
        ...(movesPoint
          ? {
            location: {
              old: { lon: before.lon, lat: before.lat },
              new: { lon: longitude, lat: latitude },
            },
          }
          : {}),
        anchorMoved,
      })],
    );
    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }

  // Outside the transaction, like every other caller: a point in a new place may
  // belong to a different region, and the assignment is recomputed from scratch
  // rather than patched. Only when the coordinate moved — a rename changes no
  // region — and never fatal to the edit, which is already committed.
  const placementFailures = movesPoint
    ? await placeAfterRelease(
      experienceId as number,
      'A curator moved a point of experience %d',
    )
    : [];

  res.json({
    success: true,
    locationId,
    anchorMoved,
    // Named the way every other caller names them, and here the placement is
    // unconditional rather than one branch of a verdict: a corrected pin whose
    // region rows did not follow is a place on the map and absent from the
    // country's list, which is what `vision.md` promises this edit fixes. The
    // curator cannot re-assign anything themselves, so what they need is enough
    // to tell an admin which object and which world views — the disclosure
    // `SECURITY.md` already argues for on the sibling endpoints.
    ...(placementFailures.length > 0 && {
      placementFailed: true,
      placementFailedWorldViews: placementFailures.map(
        f => ({ id: f.worldViewId, name: f.worldViewName })),
    }),
  });
}
