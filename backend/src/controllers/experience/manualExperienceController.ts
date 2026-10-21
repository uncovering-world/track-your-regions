/**
 * A place a curator creates by hand, with its point, its membership and its
 * first region, in one transaction.
 */

import type { PoolClient } from 'pg';
import type { z } from 'zod/v4';
import type { ManualExperienceCreated } from '../../api/responses/curation.js';
import { pool } from '../../db/index.js';
import { badRequest, createError } from '../../middleware/errorHandler.js';
import type { createManualExperienceBodySchema } from '../../types/index.js';
import { checkCuratorScope } from '../../middleware/auth.js';
import { creditForOneImage, type ImageCredit } from '../../services/sync/imageCredit.js';
import { userAgent } from '../../config/userAgent.js';
import {
  isStorableHttpUrl, isDisplayablePictureUrl, STORABLE_HTTP_URL_MESSAGE, DISPLAYABLE_PICTURE_URL_MESSAGE,
} from '../../types/urlSafety.js';
import { insertCuratedExperience } from '../../db/experienceWriter.js';
import { insertCuratedPoint } from './experienceLocationWriter.js';
import { insertManualMembership } from './membershipWriter.js';
import { refusalFor } from './curatedUrlRefusal.js';

interface CreateManualBody {
  name?: unknown;
  description?: unknown;
  type?: unknown;
  longitude?: unknown;
  latitude?: unknown;
  imageUrl?: unknown;
  tags?: unknown;
  countryCode?: unknown;
  countryName?: unknown;
  regionId?: unknown;
  kindId?: unknown;
  websiteUrl?: unknown;
  wikipediaUrl?: unknown;
}

function validateCreateManualInput(body: CreateManualBody): string | null {
  if (!body.name || body.longitude == null || body.latitude == null) {
    return 'name, longitude, and latitude are required';
  }
  const refusal = refusalFor(body.websiteUrl, isStorableHttpUrl, STORABLE_HTTP_URL_MESSAGE)
    ?? refusalFor(body.wikipediaUrl, isStorableHttpUrl, STORABLE_HTTP_URL_MESSAGE)
    ?? refusalFor(body.imageUrl, isDisplayablePictureUrl, DISPLAYABLE_PICTURE_URL_MESSAGE);
  if (refusal) return refusal;
  if (!body.regionId) {
    return 'regionId is required for initial region assignment';
  }
  if (!body.kindId) {
    return 'kindId is required';
  }
  return null;
}

/**
 * Insert the five rows a hand-made experience needs: the experience itself,
 * its one location, both region links, and the audit entry.
 *
 * The experience and its location are stamped `verified` rather than taking the
 * column's `auto` default. `auto` means "published unread" (ADR-0025); a curator
 * who typed this in and placed the point on the map already read it — they wrote
 * it. There is no source here to gate, so both stamps are the literal rather
 * than a `CASE` reading `experience_sources.requires_curation` the way the
 * sync writers do — which is also why neither is the state a sync write would
 * have produced: that one depends on the source's setting, and this one cannot.
 */
async function insertManualExperience(
  client: PoolClient,
  body: CreateManualBody,
  userId: number,
  sourceId: number,
  imageCredit: ImageCredit | null,
): Promise<{ experienceId: number; externalId: string }> {
  const externalId = `curator-${userId}-${Date.now()}`;

  const metadataObj: Record<string, unknown> = {};
  if (body.websiteUrl) metadataObj.website = body.websiteUrl as string;
  if (body.wikipediaUrl) metadataObj.wikipediaUrl = body.wikipediaUrl as string;
  // A picture a person chose is a picture somebody took. The row is `verified`
  // and published the moment it is written, so it is on a reader's screen before
  // any run could come back and name the photographer — and no run ever would:
  // this row belongs to no source, so no collector reads it. Resolved by the
  // caller before the transaction opens (see `createManualExperience`), because
  // this is a request to somebody else's server and a lock held across one is
  // held for as long as they feel like taking.
  if (imageCredit) metadataObj.imageCredit = imageCredit;
  const metadata = Object.keys(metadataObj).length > 0 ? JSON.stringify(metadataObj) : null;

  const created = await insertCuratedExperience(client, {
    sourceId,
    externalId,
    name: body.name,
    description: body.description || null,
    longitude: body.longitude,
    latitude: body.latitude,
    imageUrl: body.imageUrl || null,
    tags: body.tags ? JSON.stringify(body.tags) : null,
    countryCodes: body.countryCode ? [body.countryCode] : null,
    countryNames: body.countryName ? [body.countryName] : null,
    metadata,
    createdBy: userId,
  });
  const experienceId = created.id;

  // The place's membership in the kind the curator chose, brought by that
  // kind's own source (ADR-0045 decision 4, #822; #819). Verified from the
  // moment it is created, and visible
  // from the moment it exists: see the function comment above. A person's
  // judgement does not depend on the source's gate, so nothing here reads it.
  await insertManualMembership(client, created, sourceId, typeof body.type === 'string' && body.type !== '' ? body.type : null);

  const locationId = await insertCuratedPoint(client, created, body.name, body.longitude, body.latitude);

  await client.query(`
    INSERT INTO experience_regions (experience_id, region_id, assignment_type, assigned_by)
    VALUES ($1, $2, 'manual', $3)
  `, [experienceId, body.regionId, userId]);

  await client.query(`
    INSERT INTO experience_location_regions (location_id, region_id, assignment_type)
    VALUES ($1, $2, 'manual')
  `, [locationId, body.regionId]);

  await client.query(`
    INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
    VALUES ($1, $2, 'created', $3, $4)
  `, [experienceId, userId, body.regionId, JSON.stringify({
    name: body.name,
    type: body.type,
    kindId: body.kindId,
    sourceId,
  })]);

  return { experienceId, externalId };
}

/**
 * Create a new manual experience
 * POST /api/experiences
 * Body: { name, description?, type?, longitude, latitude, imageUrl?, tags?, countryCode?, countryName?, regionId, kindId, websiteUrl?, wikipediaUrl? }
 */
export async function createManualExperience(
  { body, caller }: { body: z.output<typeof createManualExperienceBodySchema>; caller: Express.User },
): Promise<ManualExperienceCreated> {
  const userId = caller.id;
  const userRole = caller.role;

  const validationError = validateCreateManualInput(body);
  if (validationError) {
    throw badRequest(validationError);
  }

  const hasScope = await checkCuratorScope(userId, userRole, body.regionId as number);
  if (!hasScope) {
    throw createError('You do not have curator permissions for this region', 403);
  }

  // A curator picks the kind; the row is filed under that kind's own source —
  // the one that fills it, first by display order — because a place names the
  // source that brought it (`experiences.source_id`) and a person's addition
  // has no run of its own (#819). The regional tier of ADR-0048 is where a
  // curator's list becomes a source in its own right.
  const sourceResult = await pool.query(
    `SELECT id FROM experience_sources WHERE kind_id = $1 ORDER BY display_priority, id LIMIT 1`,
    [body.kindId],
  );
  if (sourceResult.rows.length === 0) {
    throw badRequest('Invalid kindId');
  }
  const sourceId = sourceResult.rows[0].id as number;

  // Before the transaction opens, for the reason the edit path gives: this is a
  // request to somebody else's server, and a lock held across one is held for as
  // long as they feel like taking. Answers null for anything that is not a
  // Commons file or does not come back inside five seconds — a save must not
  // fail, or wait, because a metadata endpoint is slow.
  const imageCredit = await creditForOneImage(body.imageUrl as string | undefined, userAgent());

  // Pin all five inserts (experience, location, region link, location-region
  // link, curation log) to a single client so they form a real transaction.
  const client = await pool.connect();
  let created: { experienceId: number; externalId: string };
  try {
    await client.query('BEGIN');
    created = await insertManualExperience(client, body, userId, sourceId, imageCredit);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  // After the transaction rather than inside it: a body that fails its schema is
  // `respond()`'s named 500 about a write that has committed, not a ROLLBACK
  // issued after the COMMIT with nothing left to undo. The route's
  // `createManualExperienceBodySchema` has already required the name to be a
  // string.
  return {
    id: created.experienceId, name: body.name as string, externalId: created.externalId,
  };
}
