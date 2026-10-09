/**
 * Jev's judgement of the candidate Wikidata items proposed for a serial site's
 * components (#1272, ADR-0087).
 * POST /api/experiences/:id/component-item-suggestions
 *
 * For each open candidate of the site, the stored judgement where one was made
 * for the candidate as it stands, or a new one: the candidates not yet judged
 * go to Jev in one call, a `choice` question per candidate — the item is this
 * component, or another place — and each answer is stored with its confidence
 * and the candidate it was about (`componentItemSuggestions.ts`). A deployment
 * without Jev answers that it has none. The judgement is shown beside the
 * candidate and never applied: a curator decides. A POST because a call may be
 * made, and paid for.
 *
 * What Jev is sent is the catalogue's: the site's name and countries, the
 * component's name, reference and coordinate, the candidate's item, label and
 * coordinate, the distance, the name similarity and the rule that found it.
 * Nothing about the curator or any traveller.
 */

import type { z } from 'zod/v4';
import type { ComponentItemSuggestions } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import { askJevChoices, jevConfigured, type JevChoiceAsked } from '../../services/jev/jevClient.js';
import type { idParamSchema } from '../../types/index.js';
import { componentItemsScope } from './componentItemController.js';
import {
  askedSql, recordComponentItemSuggestions, type ComponentItemSuggestion, type Judgement,
} from './componentItemSuggestions.js';
import { openProposalSql } from './reviewQueuePredicates.js';

interface CandidateRow {
  proposalId: number;
  pointName: string | null;
  pointRef: string | null;
  lat: number | null;
  lon: number | null;
  item: string;
  label: string;
  distanceM: number;
  similarity: number;
  basis: 'part_of' | 'near';
  itemLat: number | null;
  itemLon: number | null;
  stored: { judgement: Judgement | null; confidence: number } | null;
}

/** The two things Jev can say of a candidate, as the options it reads. */
const CRITERIA: Record<Judgement, string> = {
  same: 'The item is this component: the same fort, fortress, tower, church, estate or stretch, whatever language or '
    + 'word order its name uses, the one place a traveller would stand at for this component',
  other: 'The item is another place: a neighbouring monument, a part inside the component, the whole of which this '
    + 'component is one part (the fort where the component is one of its gates, the site as a whole), the town, '
    + 'river or parish it is named after, a church or museum near it, or a record of finds rather than a place',
};

/**
 * What a component's name says, for Jev: the source lists a component as the
 * modern place, a dash and what the component is, often in the country's
 * language — the words a fort, a fortress, a tower, a settlement or a small
 * fort go by along the Roman frontier are the ones a candidate's label uses.
 */
const NAMING = 'A component is listed as the modern place, a dash, and what it is, in the country\'s language '
  + '(Kastell: fort; Legionslager: legionary fortress; Wachtturm: watchtower; Vicus: civilian settlement; Burgus: '
  + 'small fort; Kleinkastell: fortlet), so an item naming the same thing at the same place in another order or '
  + 'language is this component.';

const BASIS_WORDS: Record<CandidateRow['basis'], string> = {
  part_of: 'because the item says it is part of this World Heritage site, which is strong evidence; such an item\'s '
    + 'coordinate often stands a kilometre or two from the component\'s point, one placed on the modern village and '
    + 'the other on the monument, so the distance alone decides little',
  near: 'because the item lies near the point and is of the kind the site\'s other components are',
};

const at = (lat: number | null, lon: number | null): string => (lat == null || lon == null ? 'no coordinate' : `${lat}, ${lon}`);

/** The question for one candidate: the component and the item as data, and what to decide. */
export function questionFor(candidate: CandidateRow): JevChoiceAsked {
  const distance = candidate.distanceM < 0 ? 'states no coordinate' : `stands ${candidate.distanceM} m from the point`;
  return {
    instructions: `The component "${candidate.pointName ?? 'unnamed'}" (reference ${candidate.pointRef ?? 'none'}) of this `
      + `World Heritage site is at ${at(candidate.lat, candidate.lon)}. The Wikidata item "${candidate.label}" `
      + `(${candidate.item}) was found ${BASIS_WORDS[candidate.basis]}; it ${distance} (its coordinate: `
      + `${at(candidate.itemLat, candidate.itemLon)}) and its name is ${Math.round(candidate.similarity * 100)} % like the `
      + `component's. ${NAMING} Is the item this component itself, or another place near it?`,
    criteria: CRITERIA,
  };
}

async function openCandidates(
  experienceId: number,
): Promise<{ name: string; countries: string[]; candidates: CandidateRow[] } | null> {
  const result = await pool.query<{ name: string; countries: string[] | null; candidates: CandidateRow[] | null }>(
    `SELECT e.name, e.country_names AS countries,
            (SELECT jsonb_agg(jsonb_build_object(
                      'proposalId', p.id, 'pointName', el.name, 'pointRef', el.external_ref,
                      'lat', round(ST_Y(el.location)::numeric, 5), 'lon', round(ST_X(el.location)::numeric, 5),
                      'item', p.wikidata_item, 'label', p.item_label, 'distanceM', p.distance_m,
                      'similarity', p.name_similarity, 'basis', p.basis,
                      'itemLat', round(ST_Y(p.item_location)::numeric, 5), 'itemLon', round(ST_X(p.item_location)::numeric, 5),
                      'stored', (SELECT jsonb_build_object('judgement', g.judgement, 'confidence', g.confidence)
                                   FROM experience_component_item_suggestions g
                                  WHERE g.location_id = p.location_id AND g.wikidata_item = p.wikidata_item
                                    AND g.asked = ${askedSql('p')}
                                  ORDER BY g.asked_at DESC, g.id DESC LIMIT 1)) ORDER BY p.id)
               FROM experience_component_item_proposals p
               JOIN experience_locations el ON el.id = p.location_id
              WHERE el.experience_id = e.id AND ${openProposalSql('p', 'el')}) AS candidates
       FROM experiences e WHERE e.id = $1`,
    [experienceId],
  );
  const row = result.rows[0];
  return row ? { name: row.name, countries: row.countries ?? [], candidates: row.candidates ?? [] } : null;
}

/** Record one call's judgements under the site's lock. */
async function store(experienceId: number, model: string, suggestions: readonly ComponentItemSuggestion[]): Promise<void> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const locked = await lockExperience(client, experienceId);
    if (locked) await recordComponentItemSuggestions(client, locked.lock, model, suggestions);
    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

type Suggestion = ComponentItemSuggestions['suggestions'][number];

/** A stored judgement as the card shows it; none for an answer the client refused. */
function shown(candidate: CandidateRow, judgement: Judgement | null, confidence: number): Suggestion | null {
  return judgement === null ? null : { proposalId: candidate.proposalId, judgement, confidence: Number(confidence) };
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
 * Ask Jev about the candidates not yet judged as they stand, in one call, and
 * record every answer: a refused one with no judgement, so the same candidate
 * is not paid for again. Answers what the card may show. A call that fails
 * leaves those candidates without a judgement; the next opening asks again.
 */
async function judge(
  experienceId: number, place: { name: string; countries: string[] }, candidates: readonly CandidateRow[],
): Promise<Suggestion[]> {
  if (candidates.length === 0) return [];
  try {
    const questions = Object.fromEntries(candidates.map(c => [`p${c.proposalId}`, questionFor(c)]));
    const { answers, model, inputTokens } = await askJevChoices(
      { site: place.name, countries: place.countries, kind: 'World Heritage Site' }, questions,
    );
    const shares = sharedOut(inputTokens, candidates.length);
    const judged = candidates.map((c, i): ComponentItemSuggestion => {
      const answer = answers[`p${c.proposalId}`];
      return !answer || 'refused' in answer
        ? { proposalId: c.proposalId, judgement: null, confidence: 0, probabilities: {}, inputTokens: shares[i] }
        : {
          proposalId: c.proposalId, judgement: answer.choice as Judgement, confidence: answer.confidence,
          probabilities: answer.probabilities, inputTokens: shares[i],
        };
    });
    await store(experienceId, model, judged);
    return judged
      .map(s => shown(candidates.find(c => c.proposalId === s.proposalId)!, s.judgement, s.confidence))
      .filter((s): s is Suggestion => s !== null);
  } catch (error) {
    // No judgement for these candidates: the card shows them without one,
    // exactly as on a deployment without Jev.
    console.error('[jev] no judgement for the candidates of experience %d:', experienceId, error);
    return [];
  }
}

export async function suggestComponentItems(
  { params: { id }, caller }: { params: z.output<typeof idParamSchema>; caller: Express.User },
): Promise<ComponentItemSuggestions> {
  const { permitted, found } = await componentItemsScope(caller.id, caller.role, id);
  if (!found) throw notFound('Experience not found');
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  if (!jevConfigured()) return { configured: false, suggestions: [] };
  const place = await openCandidates(id);
  if (!place) throw notFound('Experience not found');
  // Judged already for the candidate as it stands: Jev's word, or none where
  // its answer was refused — either way not asked, nor paid for, again.
  const kept = place.candidates
    .filter(c => c.stored)
    .map(c => shown(c, c.stored!.judgement, c.stored!.confidence))
    .filter((s): s is Suggestion => s !== null);
  const fresh = await judge(id, place, place.candidates.filter(c => !c.stored));
  return { configured: true, suggestions: [...kept, ...fresh] };
}
