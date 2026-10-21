/**
 * A curator's edit of a place's fields: the body parsed and checked, the update
 * built, the audit row written, all under the place's lock.
 */

import type { z } from 'zod/v4';
import type { ExperienceEditResult } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { badRequest, createError, notFound } from '../../middleware/errorHandler.js';
import type { editExperienceBodySchema, idParamSchema } from '../../types/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { METADATA_CLAIM_PREFIX } from '../../services/sync/changeSet.js';
import { creditForOneImage, type ImageCredit } from '../../services/sync/imageCredit.js';
import { userAgent } from '../../config/userAgent.js';
import {
  isStorableHttpUrl, isDisplayablePictureUrl, STORABLE_HTTP_URL_MESSAGE, DISPLAYABLE_PICTURE_URL_MESSAGE,
} from '../../types/urlSafety.js';
import { lockExperience, updateExperienceColumns } from '../../db/experienceWriter.js';
import { setTypeOnSourceMembership, typeClaimedBy } from './membershipWriter.js';
import { refusalFor } from './curatedUrlRefusal.js';

type IdParams = z.output<typeof idParamSchema>;

interface FieldUpdate {
  column: string;
  bodyKey: string;
  value: unknown;
}

interface EditPayload {
  updates: FieldUpdate[];
  websiteUrl: string | undefined;
  wikipediaUrl: string | undefined;
  hasWebsiteUpdate: boolean;
  hasWikipediaUpdate: boolean;
  /**
   * Whose picture the *new* one is, resolved before the write.
   *
   * `undefined` when the edit does not touch the image at all; `null` when it
   * does and nobody could be named. Both matter: a credit belongs to one
   * photograph, so an edit that replaces the photograph must replace the credit
   * with it. Left alone, the card would go on naming the person who took the
   * picture the curator just removed — worse than naming nobody, because it is
   * a false claim about a real person.
   */
  imageCredit?: ImageCredit | null;
}

const EDIT_FIELD_MAP: Record<string, string> = {
  name: 'name',
  description: 'description',
  subtitle: 'subtitle',
  type: 'type',
  imageUrl: 'image_url',
  tags: 'tags',
};

function parseEditPayload(body: Record<string, unknown>): EditPayload {
  const updates: FieldUpdate[] = [];
  for (const [bodyKey, column] of Object.entries(EDIT_FIELD_MAP)) {
    if (body[bodyKey] !== undefined) {
      updates.push({ column, bodyKey, value: body[bodyKey] });
    }
  }
  const websiteUrl = body.websiteUrl as string | undefined;
  const wikipediaUrl = body.wikipediaUrl as string | undefined;
  return {
    updates,
    websiteUrl,
    wikipediaUrl,
    hasWebsiteUpdate: websiteUrl !== undefined,
    hasWikipediaUpdate: wikipediaUrl !== undefined,
  };
}

function validateEditPayload(payload: EditPayload): string | null {
  const { websiteUrl, wikipediaUrl, updates, hasWebsiteUpdate, hasWikipediaUpdate } = payload;
  const imageUrl = updates.find(u => u.column === 'image_url')?.value;
  const refusal = refusalFor(websiteUrl, isStorableHttpUrl, STORABLE_HTTP_URL_MESSAGE)
    ?? refusalFor(wikipediaUrl, isStorableHttpUrl, STORABLE_HTTP_URL_MESSAGE)
    ?? refusalFor(imageUrl, isDisplayablePictureUrl, DISPLAYABLE_PICTURE_URL_MESSAGE);
  if (refusal) return refusal;
  const hasMetadataUpdate = hasWebsiteUpdate || hasWikipediaUpdate;
  if (updates.length === 0 && !hasMetadataUpdate) {
    return 'No fields to update';
  }
  return null;
}

/**
 * The metadata keys this edit writes, or null where it writes none.
 *
 * Every key here is also claimed by the caller, from these same names: a value a
 * curator put in metadata and a run that may overwrite it are the two halves of
 * one decision, and they went out of step once already — the credit for a
 * picture the curator replaced.
 */
function metadataPatchOf(payload: EditPayload): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (payload.hasWebsiteUpdate) patch.website = payload.websiteUrl || null;
  if (payload.hasWikipediaUpdate) patch.wikipediaUrl = payload.wikipediaUrl || null;
  // Written in the same statement as the image itself, so no moment exists in
  // which the row holds one photograph and another photographer's name.
  if (payload.imageCredit !== undefined) patch.imageCredit = payload.imageCredit;
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * What the row holds for a column the edit sets.
 *
 * An emptied box arrives as `''` — the dialog sends a field only when it
 * changed, and taking the value away is a change — and is stored as NULL,
 * which is what every other writer says for "nothing": the manual create's
 * `|| null`, the picture repair's `SET image_url = NULL`, a run whose source
 * states no picture. The catalogue holds no `''` in any of these columns, the
 * source index is partial on `IS NOT NULL`, and the audit row names the same
 * value the row holds (#696).
 */
function clearedToNull(value: unknown): unknown {
  return value === '' ? null : value ?? null;
}

/**
 * The columns an edit sets, and the claim set it leaves, for
 * `updateExperienceColumns`: the writer binds the id as `$1`, so these bind
 * from `$2`.
 */
function buildUpdateQuery(
  payload: EditPayload,
  existingCurated: string[],
): { assignments: string[]; values: unknown[]; newCurated: string[] } {
  const { updates } = payload;
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 2;

  for (const upd of updates) {
    setClauses.push(`${upd.column} = $${paramIdx}`);
    if (upd.column === 'tags') {
      values.push(upd.value ? JSON.stringify(upd.value) : null);
    } else {
      values.push(clearedToNull(upd.value));
    }
    paramIdx++;
  }

  const patch = metadataPatchOf(payload);
  if (patch) {
    setClauses.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${paramIdx}::jsonb`);
    values.push(JSON.stringify(patch));
    paramIdx++;
  }

  const curatedFieldNames = [
    ...updates.map(u => u.column),
    // `imageCredit` alone is claimed only when it holds a value: a claimed
    // `null` would be permanent, so one Commons lookup that timed out would
    // leave a real photograph uncredited for good — and nothing overwrites the
    // gap meanwhile, because a run writes no credit for a picture it does not
    // own. The other two are the opposite: **clearing** a website or a Wikipedia
    // link is a decision, and leaving it unclaimed would have the next run write
    // the source's value straight back over it.
    ...Object.entries(patch ?? {})
      .filter(([key, value]) => key !== 'imageCredit' || (value !== null && value !== undefined))
      .map(([key]) => `${METADATA_CLAIM_PREFIX}${key}`),
  ];
  const newCurated = [...new Set([...existingCurated, ...curatedFieldNames])];
  setClauses.push(`curated_fields = $${paramIdx}`);
  values.push(JSON.stringify(newCurated));

  return { assignments: setClauses, values, newCurated };
}

/**
 * What the audit row says this edit changed.
 *
 * Every metadata key the write touches is named here, off the same patch the
 * write is built from rather than a second hand-kept list. The credit is why
 * that matters: an edit that replaces a picture also permanently claims
 * `metadata.imageCredit`, so a log naming only `image_url` would hand back a
 * claim whose provenance the trail cannot explain — and the photographer whose
 * name was replaced would be unrecoverable from it.
 */
function buildEditAuditDetails(
  payload: EditPayload,
  existing: Record<string, unknown>,
): Record<string, { old: unknown; new: unknown }> {
  const details: Record<string, { old: unknown; new: unknown }> = {};
  for (const upd of payload.updates) {
    details[upd.column] = { old: existing[upd.column], new: clearedToNull(upd.value) };
  }
  const existingMetadata = existing.metadata as Record<string, unknown> | null | undefined;
  for (const [key, value] of Object.entries(metadataPatchOf(payload) ?? {})) {
    details[`${METADATA_CLAIM_PREFIX}${key}`] = {
      old: existingMetadata?.[key] ?? null,
      new: value ?? null,
    };
  }
  return details;
}

/**
 * Edit an experience's fields
 * PATCH /api/experiences/:id/edit
 * Body: { name?, description?, subtitle?, type?, imageUrl?, tags?, websiteUrl?, wikipediaUrl? }
 * An empty string clears the field: the column is stored as NULL, and the
 * clearing is claimed like any other edit (`clearedToNull`).
 *
 * Updates curated_fields so syncs won't overwrite curator edits.
 * Logs old/new values to curation_log, under a region the caller has scope
 * over — see `resolveExperienceScope` (`experienceScope.ts`).
 */
export async function editExperience(
  { params: { id: experienceId }, body, caller }: {
    params: IdParams; body: z.output<typeof editExperienceBodySchema>; caller: Express.User;
  },
): Promise<ExperienceEditResult> {
  const userId = caller.id;
  const userRole = caller.role;

  const payload = parseEditPayload(body);
  const validationError = validateEditPayload(payload);
  if (validationError) {
    throw badRequest(validationError);
  }

  const expResult = await pool.query(
    `SELECT id, source_id, name, description, subtitle, image_url, tags, metadata, curated_fields
     FROM experiences WHERE id = $1`,
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    throw notFound('Experience not found');
  }
  const existing = expResult.rows[0];

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId,
    userRole,
    experienceId,
    existing.source_id as number,
  );
  if (!permitted) {
    throw createError('You do not have curator permissions for this experience', 403);
  }

  // Outside the transaction, because it is a request to somebody else's server
  // and a lock held across one is a lock held for as long as they feel like
  // taking. Answers null for anything that is not a Commons file or does not
  // come back inside five seconds; the write below is the same either way.
  const imageUpdate = payload.updates.find((u) => u.column === 'image_url');
  if (imageUpdate) {
    payload.imageCredit = await creditForOneImage(
      typeof imageUpdate.value === 'string' ? imageUpdate.value : null,
      // A curator is waiting on this save, so the header carries no bot marker,
      // unlike the same read inside a run (#864).
      userAgent(),
    );
  }

  // `pool.query('BEGIN')` does NOT pin a connection — each call checks out
  // an arbitrary idle client from pg.Pool, so BEGIN, the UPDATE, the audit
  // INSERT, and COMMIT/ROLLBACK can run on different clients (no real
  // transaction). Use pool.connect() to bind everything to one client.
  const client = await pool.connect();
  let unusable: Error | undefined;
  let newCurated: string[];
  try {
    await client.query('BEGIN');

    // Re-read under the lock everything this transaction depends on. The read
    // above answers 404 and scope and is outside any transaction, so by now it
    // may be stale in two ways: an accept-source releasing a claim between the
    // two would be undone here, the union putting back a key it had just
    // removed; and the `old` values in the audit row would name a version that
    // was already gone when the edit was written.
    const locked = await lockExperience<typeof existing>(
      client, experienceId, 'curated_fields, name, description, subtitle, image_url, tags, metadata',
    );
    // A row deleted since the read above has nothing to lock and nothing to
    // edit: 404, as the read would have answered a moment later. The catch
    // below rolls the transaction back.
    if (!locked) throw notFound('Experience not found');
    const before: Record<string, unknown> = { ...locked.row };
    // The type within the kind is the membership's (ADR-0084), claimed there:
    // the one the row is shown under, the membership its first source brought,
    // until #1245 lets a curator name the kind they are editing.
    const typeEdit = payload.updates.find(u => u.column === 'type');
    const placePayload = { ...payload, updates: payload.updates.filter(u => u.column !== 'type') };
    if (typeEdit) {
      const typeWrite = await setTypeOnSourceMembership(
        client, locked.lock, existing.source_id as number, clearedToNull(typeEdit.value), 'add',
      );
      before.type = typeWrite?.old ?? null;
    }
    const built = buildUpdateQuery(placePayload, (before.curated_fields as string[]) || []);
    newCurated = built.newCurated;
    if (placePayload.updates.length > 0 || metadataPatchOf(placePayload) !== null) {
      await updateExperienceColumns(client, locked.lock, built.assignments, built.values);
    }
    if (typeEdit || await typeClaimedBy(client, locked.lock, existing.source_id as number)) {
      newCurated = [...newCurated, 'type'];
    }
    const details = buildEditAuditDetails(payload, before);
    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'edited', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify(details)]);
    await client.query('COMMIT');
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled: it
    // would otherwise carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }

  return { success: true, experienceId, curatedFields: newCurated };
}
