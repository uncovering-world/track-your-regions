/**
 * A curator's correction to one point: what it is called, where it is, its own
 * picture and its description (#1270). A serial site's part keeps its picture
 * and its line under the name on its own row, as its subtitle (ADR-0156
 * decision 3): correcting its point writes them there, with the claims.
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

import type { z } from 'zod/v4';
import type { LocationEditResult } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import type { editLocationBodySchema, locationIdParamSchema } from '../../types/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { placeAfterRelease } from './publishContents.js';
import { placementReport } from './placementReport.js';
import { lockExperience, anchorToItsPoint } from '../../db/experienceWriter.js';
import { correctPoint } from './experienceLocationWriter.js';
import { userAgent } from '../../config/userAgent.js';
import { creditForOneImage, type ImageCredit } from '../../services/sync/imageCredit.js';
import { answeringPlaceSql, pointOfPartSql } from '../../db/placePoints.js';
import { writePartFields, type PartWrite } from '../../db/partFieldsWriter.js';

/** What a curator may claim on a point — see `db/migrations/027`, and #1270 for the picture and description. */
type Claim = 'name' | 'location' | 'image_url' | 'description';

/** The claims this edit adds, kept in the order the column already holds. */
function withClaims(stored: string[], added: Claim[]): string[] {
  const next = new Set(stored);
  for (const claim of added) next.add(claim);
  return [...next];
}

/** What one edit changes, `undefined` for a field it leaves alone. */
interface PointEdit {
  name: string | undefined;
  move: { lon: number; lat: number } | undefined;
  picture: string | null | undefined;
  text: string | null | undefined;
}

/** The claims one edit takes, one per field it changes. */
function claimsOf(edit: PointEdit): Claim[] {
  const claims: Claim[] = [];
  if (edit.name !== undefined) claims.push('name');
  if (edit.move) claims.push('location');
  if (edit.picture !== undefined) claims.push('image_url');
  if (edit.text !== undefined) claims.push('description');
  return claims;
}

/**
 * The edit's picture and text as the part's own fields, with the claims that
 * make them survive the next run (ADR-0156 decision 3): the text is the part's
 * subtitle.
 */
function partWriteOf(pointId: number, edit: PointEdit, credit: ImageCredit | null): PartWrite {
  const fields: PartWrite['fields'] = {};
  const addClaims: string[] = [];
  if (edit.picture !== undefined) {
    fields.image_url = edit.picture;
    fields['metadata.imageCredit'] = edit.picture && credit ? credit : null;
    addClaims.push('image_url');
  }
  if (edit.text !== undefined) {
    fields.subtitle = edit.text;
    addClaims.push('subtitle');
  }
  return { pointId, fields, addClaims };
}

/**
 * The log entry's changes: only the keys this edit actually changed, each under
 * its column's name. The queue's claim attribution asks `details ? '<column>'`
 * to find who claimed a field, so a key present and null would make a rename
 * answer for the coordinate — the attribution would name a curator who never
 * touched it.
 */
function editDetails(
  before: { name: string | null; lon: number; lat: number; image_url: string | null; description: string | null; of_part: boolean },
  edit: PointEdit,
): Record<string, unknown> {
  return {
    ...(edit.name === undefined ? {} : { name: { old: before.name, new: edit.name } }),
    ...(edit.move ? { location: { old: { lon: before.lon, lat: before.lat }, new: edit.move } } : {}),
    ...(edit.picture === undefined ? {} : { image_url: { old: before.image_url, new: edit.picture } }),
    ...(edit.text === undefined ? {} : { [before.of_part ? 'subtitle' : 'description']: { old: before.description, new: edit.text } }),
  };
}

export async function editLocation(
  { params: { locationId }, body: { name, latitude, longitude, imageUrl, description }, caller }: {
    params: z.output<typeof locationIdParamSchema>; body: z.output<typeof editLocationBodySchema>; caller: Express.User;
  },
): Promise<LocationEditResult> {
  const userId = caller.id;
  const userRole = caller.role;
  const movesPoint = latitude !== undefined && longitude !== undefined;
  // `''` is how a form says "none", as on a work: the point then shows its
  // object's picture. `undefined` leaves the field alone.
  const picture = imageUrl === undefined ? undefined : (imageUrl || null);
  const text = description === undefined ? undefined : (description || null);
  const pointEdit: PointEdit = {
    name, picture, text, move: movesPoint ? { lon: longitude, lat: latitude } : undefined,
  };

  // The point carries no scope of its own: it is judged through the object
  // holding it, as a whole, which is where the regions and the memberships live.
  const found = await pool.query(
    `SELECT ${answeringPlaceSql()} AS experience_id
       FROM experience_locations el
       JOIN experiences e ON e.id = ${answeringPlaceSql()}
      WHERE el.id = $1`,
    [locationId],
  );
  if (found.rows.length === 0) {
    throw notFound('Location not found');
  }
  const { experience_id: experienceId } = found.rows[0];

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId as number, 'place',
  );
  if (!permitted) {
    throw createError('You do not have curator permissions for this experience', 403);
  }

  // Whose photograph the new one is, asked before the transaction opens, as a
  // work's edit asks: a request to Commons is not something to hold a lock
  // across. Null for a picture removed, one not on Commons, or one Commons did
  // not answer for in time — and a null written is the point: the credit of the
  // photograph this replaces must not stay under it.
  // A curator's save, not a run: no bot marker on this one (#864).
  const credit: ImageCredit | null = picture === undefined ? null : await creditForOneImage(picture, userAgent());

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
    const object = await lockExperience(client, experienceId);

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
    // A part's picture and text are its own row's (ADR-0156 decision 3), read
    // there; the site's lock, held above, is what every writer of them takes.
    const locked = await client.query(
      `SELECT el.name, el.curated_fields, ${pointOfPartSql('el')} AS of_part,
              CASE WHEN ${pointOfPartSql('el')} THEN part.image_url ELSE el.image_url END AS image_url,
              CASE WHEN ${pointOfPartSql('el')} THEN part.subtitle ELSE el.description END AS description,
              ST_Y(el.location::geometry) AS lat, ST_X(el.location::geometry) AS lon
         FROM experience_locations el JOIN experiences part ON part.id = el.experience_id
        WHERE el.id = $1 FOR UPDATE OF el`,
      [locationId],
    );
    const before = locked.rows[0] as {
      name: string | null; curated_fields: string[]; lat: number; lon: number;
      image_url: string | null; description: string | null; of_part: boolean;
    } | undefined;
    // The object going takes its points with it, so a missing object is the
    // same 404 as a missing point. The catch below rolls the transaction back.
    if (!before || !object) throw notFound('Location not found');

    if (before.of_part) {
      const pointClaims = claimsOf({ ...pointEdit, picture: undefined, text: undefined });
      await correctPoint(client, object.lock, locationId, {
        name: name ?? null, movesPoint, longitude: longitude ?? null, latitude: latitude ?? null,
        curatedFields: withClaims(before.curated_fields ?? [], pointClaims),
      });
      await writePartFields(client, object.lock, [partWriteOf(locationId, pointEdit, credit)]);
    } else {
      await correctPoint(client, object.lock, locationId, {
        name: name ?? null, movesPoint, longitude: longitude ?? null, latitude: latitude ?? null,
        picture, credit, description: text,
        curatedFields: withClaims(before.curated_fields ?? [], claimsOf(pointEdit)),
      });
    }

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
      anchorMoved = await anchorToItsPoint(client, object.lock, longitude, latitude, locationId);
    }

    await client.query(
      `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
       VALUES ($1, $2, 'location_edited', $3, $4)`,
      // Only the keys this edit actually changed (`editDetails`).
      [experienceId, userId, logRegionId, JSON.stringify({
        locationId,
        ...editDetails(before, pointEdit),
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

  return {
    success: true,
    locationId,
    anchorMoved,
    // Who is named under the new picture, answered rather than promised: a
    // Commons file whose credit request timed out is stored with none.
    ...(picture === undefined ? {} : { imageCredit: credit }),
    // Named the way every other caller names them, and here the placement is
    // unconditional rather than one branch of a verdict: a corrected pin whose
    // region rows did not follow is a place on the map and absent from the
    // country's list, which is what `vision.md` promises this edit fixes. The
    // curator cannot re-assign anything themselves, so what they need is enough
    // to tell an admin which object and which world views — the disclosure
    // `SECURITY.md` already argues for on the sibling endpoints.
    ...placementReport(placementFailures),
  };
}
