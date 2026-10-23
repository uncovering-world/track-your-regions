/**
 * Jev's judgement of the hints of where a site's roughly placed components
 * stand (#1913, ADR-0087).
 * POST /api/experiences/:id/point-hint-suggestions
 *
 * For each hint on the site's *Where is it?* card (`approximate-points`), the
 * stored judgement where one was made for the hint as it stands, or a new one:
 * the hints not yet judged go to Jev in one call, a `choice` question per hint
 * — it is where the component stands, or another place — and each answer is
 * stored with its confidence (`pointHintSuggestions.ts`). A deployment without
 * Jev answers that it has none. The judgement is shown beside the hint and
 * never applied: a curator places the point. A POST because a call may be
 * made, and paid for.
 *
 * What Jev is sent is the catalogue's: the site's name and countries, the
 * component's name, reference, coordinate and why the list's point is rough,
 * the hint's source, label, coordinate and distance, and an OpenStreetMap
 * object's tags. Nothing about the curator or any traveller.
 */

import type { z } from 'zod/v4';
import type { PointHintSuggestions } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { pointsShownSql } from '../../db/placePoints.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import { askJevChoices, jevConfigured, type JevChoiceAsked } from '../../services/jev/jevClient.js';
import type { idParamSchema } from '../../types/index.js';
import { componentItemsScope } from './componentItemController.js';
import {
  hintAskedSql, recordPointHintSuggestions,
  type HintJudgement, type HintSource, type PointHintSuggestion,
} from './pointHintSuggestions.js';
import { approximatePointAskedSql } from './reviewQueuePredicates.js';
import { HINTS } from './reviewQueueApproximatePoints.js';

interface HintRow {
  locationId: number;
  pointName: string | null;
  pointRef: string | null;
  reason: 'whole-minute' | 'shared';
  lat: number;
  lon: number;
  source: HintSource;
  ref: string;
  label: string | null;
  metres: number;
  tags: Record<string, string> | null;
  hintLat: number;
  hintLon: number;
  stored: { judgement: HintJudgement | null; confidence: number } | null;
}

/** The two things Jev can say of a hint, as the options it reads. */
const CRITERIA: Record<HintJudgement, string> = {
  same: 'The hint is where this component stands: the same monument, building, site or protected area, whatever '
    + 'language or word order its name uses, the place a traveller would go to for this component',
  other: 'The hint is another place: the town, village or district the component is named after, a different '
    + 'monument, building or rock shelter nearby, a part inside the component, or the whole site rather than this '
    + 'component',
};

const SOURCE_WORDS: Record<HintSource, string> = {
  'osm-ref': 'an OpenStreetMap object that carries this component\'s World Heritage reference, which is strong evidence',
  item: 'the coordinate of the component\'s own Wikidata item',
  candidate: 'a Wikidata item proposed for the component by its name and kind near the point',
  'osm-name': 'an OpenStreetMap object near the point named like the component; a name alone often matches a '
    + 'neighbouring place of the same kind',
};

const REASON_WORDS: Record<HintRow['reason'], string> = {
  'whole-minute': 'gives it only to the whole minute of arc, so it may stand a kilometre or more from that point',
  shared: 'gives it the same point as other components of the site, so the point stands for none of them',
};

/** The tags that say what an OpenStreetMap object is, for Jev; its names are in the label already. */
const TELLING_TAGS = [
  'historic', 'tourism', 'amenity', 'building', 'religion', 'denomination', 'heritage', 'ruins', 'archaeological_site',
  'site_type', 'man_made', 'natural', 'leisure', 'boundary', 'protect_class', 'place', 'ref:whc', 'wikidata',
];

/** An object's telling tags as `key=value`, or none. */
function tagWords(tags: HintRow['tags']): string {
  if (!tags) return '';
  const said = TELLING_TAGS.filter(key => typeof tags[key] === 'string').map(key => `${key}=${tags[key]}`);
  return said.length > 0 ? ` Its OpenStreetMap tags: ${said.join(', ')}.` : '';
}

/** The question for one hint: the component and the hint as data, and what to decide. */
export function questionFor(hint: HintRow): JevChoiceAsked {
  return {
    instructions: `The component "${hint.pointName ?? 'unnamed'}" (reference ${hint.pointRef ?? 'none'}) of this World `
      + `Heritage site is listed at ${hint.lat}, ${hint.lon}, but the list ${REASON_WORDS[hint.reason]}. A hint of where `
      + `it really stands is "${hint.label ?? hint.ref}" (${hint.ref}), ${SOURCE_WORDS[hint.source]}, at ${hint.hintLat}, `
      + `${hint.hintLon}, ${hint.metres} m from the listed point.${tagWords(hint.tags)} Is the hint where this component `
      + 'stands, or another place?',
    criteria: CRITERIA,
  };
}

async function openHints(experienceId: number): Promise<{ name: string; countries: string[]; hints: HintRow[] } | null> {
  const result = await pool.query<{ name: string; countries: string[] | null; hints: HintRow[] | null }>(
    `SELECT e.name, e.country_names AS countries,
            (SELECT jsonb_agg(jsonb_build_object(
                      'locationId', el.id, 'pointName', el.name, 'pointRef', el.external_ref, 'reason', el.approximate,
                      'lat', round(ST_Y(el.location)::numeric, 5), 'lon', round(ST_X(el.location)::numeric, 5),
                      'source', h.source, 'ref', h.ref, 'label', h.label, 'metres', h.metres, 'tags', h.tags,
                      'hintLat', round(ST_Y(h.at)::numeric, 5), 'hintLon', round(ST_X(h.at)::numeric, 5),
                      'stored', (SELECT jsonb_build_object('judgement', g.judgement, 'confidence', g.confidence)
                                   FROM experience_point_hint_suggestions g
                                  WHERE g.location_id = el.id AND g.source = h.source AND g.ref = h.ref
                                    AND g.asked = ${hintAskedSql('h')}
                                  ORDER BY g.asked_at DESC, g.id DESC LIMIT 1)) ORDER BY el.id, h.source, h.ref)
               FROM ${pointsShownSql('e.id', 'el')}
              CROSS JOIN LATERAL (${HINTS}) h
              WHERE ${approximatePointAskedSql(true, 'el')}) AS hints
       FROM experiences e WHERE e.id = $1`,
    [experienceId],
  );
  const row = result.rows[0];
  return row ? { name: row.name, countries: row.countries ?? [], hints: row.hints ?? [] } : null;
}

/** Record one call's judgements under the site's lock. */
async function store(experienceId: number, model: string, suggestions: readonly PointHintSuggestion[]): Promise<void> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const locked = await lockExperience(client, experienceId);
    if (locked) await recordPointHintSuggestions(client, locked.lock, model, HINTS, suggestions);
    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

type Suggestion = PointHintSuggestions['suggestions'][number];

/** A judgement as the card shows it; none for an answer the client refused. */
function shown(hint: Pick<HintRow, 'locationId' | 'source' | 'ref'>, judgement: HintJudgement | null, confidence: number): Suggestion | null {
  return judgement === null
    ? null
    : { locationId: hint.locationId, source: hint.source, ref: hint.ref, judgement, confidence: Number(confidence) };
}

/**
 * The call's input tokens shared out over its questions, whole tokens each,
 * the remainder on the first: the rows added up are what the call cost.
 */
function sharedOut(inputTokens: number, count: number): number[] {
  const each = Math.floor(inputTokens / count);
  return Array.from({ length: count }, (_, i) => each + (i === 0 ? inputTokens - each * count : 0));
}

/**
 * Ask Jev about the hints not yet judged as they stand, in one call, and
 * record every answer: a refused one with no judgement, so the same hint is
 * not paid for again. Answers what the card may show. A call that fails leaves
 * those hints without a judgement; the next opening asks again.
 */
async function judge(
  experienceId: number, place: { name: string; countries: string[] }, hints: readonly HintRow[],
): Promise<Suggestion[]> {
  if (hints.length === 0) return [];
  try {
    const questions = Object.fromEntries(hints.map((hint, i) => [`h${i}`, questionFor(hint)]));
    const { answers, model, inputTokens } = await askJevChoices(
      { site: place.name, countries: place.countries, kind: 'World Heritage Site' }, questions,
    );
    const shares = sharedOut(inputTokens, hints.length);
    const judged = hints.map((hint, i): PointHintSuggestion => {
      const answer = answers[`h${i}`];
      const key = { locationId: hint.locationId, source: hint.source, ref: hint.ref, inputTokens: shares[i] };
      return !answer || 'refused' in answer
        ? { ...key, judgement: null, confidence: 0, probabilities: {} }
        : { ...key, judgement: answer.choice as HintJudgement, confidence: answer.confidence, probabilities: answer.probabilities };
    });
    await store(experienceId, model, judged);
    return judged.map(s => shown(s, s.judgement, s.confidence)).filter((s): s is Suggestion => s !== null);
  } catch (error) {
    // No judgement for these hints: the card shows them without one, exactly
    // as on a deployment without Jev.
    console.error('[jev] no judgement for the point hints of experience %d:', experienceId, error);
    return [];
  }
}

export async function suggestPointHints(
  { params: { id }, caller }: { params: z.output<typeof idParamSchema>; caller: Express.User },
): Promise<PointHintSuggestions> {
  const { permitted, found } = await componentItemsScope(caller.id, caller.role, id);
  if (!found) throw notFound('Experience not found');
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  if (!jevConfigured()) return { configured: false, suggestions: [] };
  const place = await openHints(id);
  if (!place) throw notFound('Experience not found');
  // Judged already for the hint as it stands: Jev's word, or none where its
  // answer was refused — either way not asked, nor paid for, again.
  const kept = place.hints
    .filter(h => h.stored)
    .map(h => shown(h, h.stored!.judgement, h.stored!.confidence))
    .filter((s): s is Suggestion => s !== null);
  const fresh = await judge(id, place, place.hints.filter(h => !h.stored));
  return { configured: true, suggestions: [...kept, ...fresh] };
}
