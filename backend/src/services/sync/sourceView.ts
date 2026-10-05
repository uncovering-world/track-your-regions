/**
 * What a run does about another source's view of the place it is writing
 * (ADR-0084, #1246).
 *
 * The upsert records the run's own view on its membership whatever happens to
 * the place, and asks here which of the fields it brings another source of the
 * same place contradicts, and which it reports empty where another source
 * reports a value. Those it writes as the place already holds them: the
 * place keeps its value and the run proposes nothing about the field, so
 * neither source overwrites the other; the two views stand on the memberships
 * until the sources agree. A field no other source contradicts follows the gate
 * and the claims exactly as before.
 *
 * Kept as the place holds it rather than guarded in the statement, so the
 * statement's arms, the diff and the held proposal all see one record: a
 * contested field is no difference at all, and so it is neither written, nor
 * held, nor filed as a refused claim.
 */

import type { PoolClient } from 'pg';
import { MEMBERSHIPS } from '../../db/membership.js';
import {
  membershipViewSql, viewDisagreementsSql, viewSilencesSql, viewStandsSql, VIEW_FIELDS, type ViewField,
} from '../../db/sourceViews.js';

/**
 * The part of a run's record a view is read from, as `ExperienceUpsertParams`
 * carries it (declared here rather than imported, since the upsert imports this
 * module).
 */
export interface ViewRecord {
  sourceId: number;
  externalId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  lon: number;
  lat: number;
  metadata: Record<string, unknown>;
}

/** The stored columns `keptAsStored` puts back, as the upsert's snapshot read them. */
export interface StoredView {
  name: string;
  description: string | null;
  image_url: string | null;
  metadata: Record<string, unknown> | null;
  lon: number | string;
  lat: number | string;
}

/**
 * The fields of the run's record that some other standing view of the place
 * contradicts, or that the run leaves empty where another view reports a value
 * (`viewSilencesSql`): either way the run's value is not the place's to take.
 *
 * Only views under another id ask (ADR-0085). Two sources that know the place by one
 * Wikidata item read one item, and every reader keeps one picture and one
 * coordinate of it (`preferredPicture`, `preferredCoordinate`), so where their
 * views differ one of them read the item before an edit the other has seen:
 * the newer reading is written, and nobody is asked (#1246). The question is
 * for sources that are different data — a World Heritage id beside a Wikidata
 * item.
 * `placeId` is the place the run's lock found; a place the run is creating has
 * no other view and is not asked.
 */
export async function contestedFields(
  query: Pick<PoolClient, 'query'>,
  placeId: number,
  params: ViewRecord,
): Promise<ViewField[]> {
  const incoming = {
    name: '$3::text',
    description: '$4::text',
    imageUrl: '$5::text',
    location: 'ST_SetSRID(ST_MakePoint($6::float8, $7::float8), 4326)',
  };
  const result = await query.query<{ field: ViewField }>(
    `SELECT DISTINCT unnest(
              ${viewDisagreementsSql(incoming, membershipViewSql('m'))}
              || ${viewSilencesSql(incoming, membershipViewSql('m'))}) AS field
       FROM ${MEMBERSHIPS} m
      WHERE m.experience_id = $1
        AND m.external_id <> $2
        AND ${viewStandsSql('m')}`,
    [placeId, params.externalId, params.name, params.description, params.imageUrl, params.lon, params.lat],
  );
  const contested = new Set(result.rows.map(row => row.field));
  return VIEW_FIELDS.filter(field => contested.has(field));
}

/**
 * The run's record with each contested field as the place holds it. The
 * picture's credit goes with the picture: the place keeps the credit of the
 * photograph it keeps, or none where it holds none.
 */
export function keptAsStored<T extends ViewRecord>(
  params: T,
  stored: StoredView,
  contested: readonly ViewField[],
): T {
  if (contested.length === 0) return params;
  const kept = { ...params, metadata: { ...params.metadata } };
  for (const field of contested) {
    if (field === 'name') kept.name = stored.name;
    if (field === 'description') kept.description = stored.description;
    if (field === 'location') {
      kept.lon = Number(stored.lon);
      kept.lat = Number(stored.lat);
    }
    if (field === 'imageUrl') {
      kept.imageUrl = stored.image_url;
      const storedMetadata = stored.metadata ?? {};
      if (Object.hasOwn(storedMetadata, 'imageCredit')) kept.metadata.imageCredit = storedMetadata.imageCredit;
      else delete kept.metadata.imageCredit;
    }
  }
  return kept;
}
