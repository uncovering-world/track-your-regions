/**
 * Jev's suggested answer to the card that asks which of two sources' views a
 * place shows (#1260).
 * POST /api/experiences/:id/view-suggestions
 *
 * For each field the card asks about, the stored suggestion where it was made
 * for the views as they stand, or a new one: Jev is asked one `choice` over the
 * views, and the answer is stored with its confidence and the views it was
 * about (`viewSuggestions.ts`). A deployment without Jev answers that it has
 * none. The suggestion is shown beside the views and never applied: a curator
 * decides. A POST because a call may be made, and paid for.
 *
 * What Jev is sent is the catalogue's: the place's name and countries, each
 * source's kind and name, and per view its text, its picture's file name and
 * credit, or its coordinate. Nothing about the curator or any traveller.
 */

import type { z } from 'zod/v4';
import type { ViewSuggestions } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { KINDS, MEMBERSHIPS } from '../../db/membership.js';
import {
  openViewFieldsSql, viewStandsSql, viewValueSql, viewsOfFieldSql, type ViewField,
} from '../../db/sourceViews.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import {
  askJevChoice, jevConfigured, JevAnswerRefused, type JevChoiceQuestion,
} from '../../services/jev/jevClient.js';
import type { idParamSchema } from '../../types/index.js';
import { resolveEverySourceScope } from './experienceScope.js';
import { recordViewSuggestion } from './viewSuggestions.js';

interface ViewRow {
  membership_id: number;
  kind: string;
  source: string;
  value: string | null;
  credit: { author?: string; license?: string } | null;
  lat: number | null;
  lon: number | null;
}

interface FieldRow {
  field: ViewField;
  views: ViewRow[];
  /** The field's views as `viewsOfFieldSql` states them, what a suggestion is recorded for. */
  snapshot: unknown;
  stored: { membership_id: number | null; confidence: number } | null;
}

/** What to decide, per field, in words a traveller's judgement answers. */
const INSTRUCTIONS: Record<ViewField, string> = {
  name: 'Two sources name this place differently. Which name should a traveller see: the one the place is known '
    + 'by and signposted under, in English where English has one, rather than a formal or administrative title?',
  description: 'Two sources describe this place differently. Which description tells a traveller more truthfully '
    + 'and usefully what the place is?',
  imageUrl: 'Two sources show this place with different photographs. Which should represent it to a traveller '
    + 'deciding whether to go: the place itself, recognisable, as a visitor sees it? Judge from the file name.',
  location: 'Two sources put this place at different points. Which point marks it better for a traveller: on the '
    + 'place itself, at its centre or main entrance, rather than beside it?',
};

const fileName = (url: string): string => {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? url);
  } catch {
    return url;
  }
};

/** One view as Jev reads an option. */
function optionOf(field: ViewField, view: ViewRow): string {
  const whose = `as ${view.source} (${view.kind}) has it`;
  if (field === 'imageUrl' && view.value) {
    const by = view.credit?.author ? `, by ${view.credit.author}` : '';
    return `The photograph "${fileName(view.value)}"${by} — ${whose}`;
  }
  if (field === 'location') return `The point ${view.lat}, ${view.lon} — ${whose}`;
  return `"${view.value}" — ${whose}`;
}

/** The question for one field: the place as data, and one option per view. */
export function questionFor(place: { name: string; countries: string[] }, field: FieldRow): JevChoiceQuestion {
  const criteria = Object.fromEntries(field.views.map(view => [`view${view.membership_id}`, optionOf(field.field, view)]));
  return {
    state: { place: place.name, countries: place.countries, kinds: field.views.map(view => view.kind) },
    instructions: INSTRUCTIONS[field.field],
    criteria,
  };
}

async function openFields(
  experienceId: number,
): Promise<{ name: string; countries: string[]; sourceIds: number[]; fields: FieldRow[] } | null> {
  const result = await pool.query<{
    name: string; countries: string[] | null; source_ids: number[] | null; fields: FieldRow[] | null;
  }>(
    `SELECT e.name, e.country_names AS countries,
            (SELECT array_agg(DISTINCT m.source_id ORDER BY m.source_id) FROM ${MEMBERSHIPS} m
              WHERE m.experience_id = e.id) AS source_ids,
            (SELECT jsonb_agg(jsonb_build_object(
                      'field', f,
                      'snapshot', ${viewsOfFieldSql('e.id', 'f')},
                      'views', (SELECT jsonb_agg(jsonb_build_object(
                                         'membership_id', m.id, 'kind', k.name, 'source', s.name,
                                         'value', ${viewValueSql('f', 'm')}, 'credit', m.reported_image_credit,
                                         'lat', round(ST_Y(m.reported_location)::numeric, 5),
                                         'lon', round(ST_X(m.reported_location)::numeric, 5)) ORDER BY m.id)
                                  FROM ${MEMBERSHIPS} m
                                  JOIN ${KINDS} k ON k.id = m.kind_id
                                  JOIN experience_sources s ON s.id = m.source_id
                                 WHERE m.experience_id = e.id AND ${viewStandsSql('m')}
                                   AND NULLIF(${viewValueSql('f', 'm')}, '') IS NOT NULL),
                      'stored', (SELECT jsonb_build_object('membership_id', g.suggested_membership_id,
                                                           'confidence', g.confidence)
                                   FROM experience_view_suggestions g
                                  WHERE g.experience_id = e.id AND g.field = f
                                    AND g.views = ${viewsOfFieldSql('e.id', 'f')}
                                  ORDER BY g.asked_at DESC, g.id DESC LIMIT 1)))
               FROM unnest(${openViewFieldsSql('e.id')}) AS f) AS fields
       FROM experiences e WHERE e.id = $1`,
    [experienceId],
  );
  const row = result.rows[0];
  return row
    ? { name: row.name, countries: row.countries ?? [], sourceIds: row.source_ids ?? [], fields: row.fields ?? [] }
    : null;
}

/** Record one call under the place's lock; whether its answer is about the views as they stand. */
async function store(experienceId: number, suggestion: Parameters<typeof recordViewSuggestion>[2]): Promise<boolean> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const locked = await lockExperience(client, experienceId);
    const kept = locked ? await recordViewSuggestion(client, locked.lock, suggestion) : false;
    await client.query('COMMIT');
    return kept;
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

type Suggestion = ViewSuggestions['suggestions'][number];

/**
 * One field's suggestion: the stored one for its views as they stand, or a new
 * call. Null where there is none to show — none asked for a field one view
 * reports, an answer refused, an answer about views a run changed meanwhile,
 * or a call that failed.
 */
async function suggestionFor(
  id: number, place: { name: string; countries: string[] }, field: FieldRow,
): Promise<Suggestion | null> {
  // Asked already for these views: Jev's pick, or no pick where its answer
  // was refused — either way not asked, nor paid for, again.
  if (field.stored) {
    return field.stored.membership_id == null ? null
      : { field: field.field, membershipId: field.stored.membership_id, confidence: Number(field.stored.confidence) };
  }
  if (field.views.length < 2) return null;
  try {
    const answer = await askJevChoice(questionFor(place, field));
    const membershipId = Number(answer.choice.replace(/^view/, ''));
    const current = await store(id, {
      field: field.field, membershipId, confidence: answer.confidence,
      probabilities: answer.probabilities, model: answer.model, inputTokens: answer.inputTokens,
      views: field.snapshot,
    });
    // A source changed its view during the call: the answer is about views
    // nobody sees now — recorded for what it cost, not shown, and the next
    // opening asks about the new ones.
    return current ? { field: field.field, membershipId, confidence: answer.confidence } : null;
  } catch (error) {
    // An answer the client refused was still paid for: recorded with no
    // pick, so the cost is counted and the same views are not asked again.
    if (error instanceof JevAnswerRefused) {
      await store(id, {
        field: field.field, membershipId: null, confidence: 0, probabilities: {},
        model: error.model, inputTokens: error.inputTokens, views: field.snapshot,
      }).catch(() => undefined);
    }
    // No suggestion for this field: the card shows the views without one,
    // exactly as on a deployment without Jev.
    console.error('[jev] no suggestion for experience %d, %s:', id, field.field, error);
    return null;
  }
}

export async function suggestViews(
  { params: { id }, caller }: { params: z.output<typeof idParamSchema>; caller: Express.User },
): Promise<ViewSuggestions> {
  const { permitted, sourceIds } = await resolveEverySourceScope(caller.id, caller.role, id);
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  if (!jevConfigured()) return { configured: false, suggestions: [] };
  const place = await openFields(id);
  if (!place) throw notFound('Experience not found');
  // The views were read in one statement after the scope was checked; a merge
  // in between may have brought a source nobody checked the curator for, and
  // its views are not sent anywhere on their behalf. The next opening asks.
  if (place.sourceIds.join(',') !== sourceIds.join(',')) return { configured: true, suggestions: [] };

  // The fields are independent questions: asked at once, so a card with four
  // waits for the slowest, not for the four in turn.
  const answered = await Promise.all(place.fields.map(field => suggestionFor(id, place, field)));
  const suggestions = answered.filter((one): one is Suggestion => one !== null);
  return { configured: true, suggestions };
}
