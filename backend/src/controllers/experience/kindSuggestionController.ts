/**
 * Jev's reading of which kind, live or planned, a place arriving for a curator
 * belongs to (#2342, ADR-0087), and the curator's answer about a planned one.
 * POST /api/experiences/:id/kind-suggestion
 * POST /api/experiences/:id/planned-kind-answer   { plannedKind, belongs }
 *
 * For a place a gated source is bringing in, the stored reading where one was
 * made for the place and the kinds offered as they stand, or a new one: Jev is
 * asked one `choice` over the catalogue's live kinds, the register's planned
 * place kinds and none of them, each with the register's definition
 * (`kindReading.ts`), and the answer is stored with its confidence and what it
 * was about (`kindSuggestions.ts`). A deployment without Jev answers that it
 * has none. The reading is shown beside the arrival and never applied: a
 * curator decides — through the arrival's own "Belongs in another kind…"
 * where it names a live kind, or by saying whether the place belongs to the
 * planned one, which is recorded (`plannedKindAnswers.ts`) so the kind's
 * candidates can be listed when it is built. A POST because a call may be
 * made, and paid for.
 *
 * Asked in the scope of an arriving membership's source, as the visit reading
 * is (`visitSuggestionController.ts`): the question is about the arrival.
 *
 * What Jev is sent is the catalogue's: the place's name, countries and
 * description, the map's tag, the lead of its English Wikipedia article, read
 * from Wikipedia for the question, and the kinds with their definitions.
 * Nothing about the curator or any traveller.
 */

import type { z } from 'zod/v4';
import type { KindSuggestion, PlannedKindAnswered } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { MEMBERSHIPS, membershipAdmittedSql, membershipOfferedSql } from '../../db/membership.js';
import { badRequest, createError, notFound } from '../../middleware/errorHandler.js';
import { askJevChoice, jevConfigured, JevAnswerRefused } from '../../services/jev/jevClient.js';
import { articleLead } from '../../services/sync/visit/visitReading.js';
import type { idParamSchema, plannedKindAnswerBodySchema } from '../../types/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { kindReadingQuestion, NO_KIND, optionKey, type KindOption, type KindReadingAsked } from './kindReading.js';
import {
  askedSql, kindOptionsSql, newestKindReadingSql, recordKindSuggestion, type KindReading, type KindSuggestionRecord,
} from './kindSuggestions.js';
import { recordPlannedKindAnswer } from './plannedKindAnswers.js';
import { arrivalOpenSql } from './reviewQueuePredicates.js';

interface OptionRow { kind_id: number | null; slug: string | null; name: string; definition: string; issue: number | null }

interface PlaceRow {
  asked: KindReadingAsked & { kinds: string };
  /** The sources of the place's open arrivals; none where it is not arriving. */
  arrivingSourceIds: number[];
  options: KindOption[];
  /** The kinds the place has a membership in, of any state, by its standing: a curator cannot put it into one of them. */
  heldKinds: Record<string, HeldStanding>;
  stored: { reading: KindReading['reading'] | null; kindId: number | null; plannedKind: string | null; confidence: number } | null;
  /** A curator's answers about planned kinds, by slug. */
  answers: Record<string, boolean>;
}

const optionOf = (row: OptionRow): KindOption => (row.kind_id !== null
  ? { live: true, kindId: row.kind_id, name: row.name, definition: row.definition }
  : { live: false, slug: row.slug!, name: row.name, definition: row.definition, issue: row.issue });

/** The place, the kinds offered and what is stored, in one statement: the digest recorded is of the kinds sent. */
async function placeOf(experienceId: number): Promise<PlaceRow | null> {
  const result = await pool.query<{
    asked: PlaceRow['asked']; arriving_source_ids: number[] | null; options: OptionRow[];
    held_kinds: Record<string, HeldStanding> | null; stored: PlaceRow['stored']; answers: Record<string, boolean> | null;
  }>(
    `SELECT ${askedSql('e')} AS asked,
            (SELECT array_agg(DISTINCT m.source_id ORDER BY m.source_id) FROM ${MEMBERSHIPS} m
              WHERE m.experience_id = e.id AND ${arrivalOpenSql('e', 'm')}) AS arriving_source_ids,
            (SELECT jsonb_agg(jsonb_build_object('kind_id', o.kind_id, 'slug', o.slug, 'name', o.name,
                                                 'definition', o.definition, 'issue', o.issue)
                              ORDER BY o.rank, o.kind_id, o.slug)
               FROM ${kindOptionsSql()} o) AS options,
            (SELECT jsonb_object_agg(held.kind_id, CASE
                      WHEN ${membershipOfferedSql('held')} THEN 'offered'
                      WHEN NOT ${membershipAdmittedSql('held')} THEN 'kept_out'
                      ELSE 'arriving' END)
               FROM ${MEMBERSHIPS} held WHERE held.experience_id = e.id) AS held_kinds,
            ${newestKindReadingSql('e')} AS stored,
            (SELECT jsonb_object_agg(a.planned_kind, a.belongs) FROM experience_planned_kind_answers a
              WHERE a.experience_id = e.id) AS answers
       FROM experiences e WHERE e.id = $1`,
    [experienceId],
  );
  const row = result.rows[0];
  return row
    ? {
      asked: row.asked, arrivingSourceIds: row.arriving_source_ids ?? [], options: (row.options ?? []).map(optionOf),
      heldKinds: row.held_kinds ?? {},
      stored: row.stored, answers: row.answers ?? {},
    }
    : null;
}

/** The place is still arriving, under the lock: what a reading is shown for. */
const STILL_ARRIVING = `EXISTS (SELECT 1 FROM ${MEMBERSHIPS} m WHERE m.experience_id = e.id AND ${arrivalOpenSql('e', 'm')})`;

/** Whether the caller curates one of the place's arriving sources; 403 otherwise. */
async function requireArrivalScope(caller: Express.User, experienceId: number, sourceIds: readonly number[]): Promise<void> {
  const scopes = await Promise.all(
    sourceIds.map(sourceId => resolveExperienceScope(caller.id, caller.role, experienceId, sourceId)),
  );
  if (!scopes.some(scope => scope.permitted)) {
    throw createError('You do not have curator permissions for this experience', 403);
  }
}

type Suggestion = NonNullable<KindSuggestion['suggestion']>;
type HeldStanding = NonNullable<NonNullable<Suggestion['kind']>['held']>;

/** A reading as the card shows it, its kind named; none for an answer refused or a kind no longer offered. */
function shown(place: PlaceRow, pick: KindReading, confidence: number): Suggestion | null {
  if (pick.reading === 'none') return { reading: 'none', kind: null, plannedKind: null, confidence };
  if (pick.reading === 'live') {
    const kind = place.options.find(o => o.live && o.kindId === pick.kindId);
    if (!kind) return null;
    const held = place.heldKinds[String(pick.kindId)] ?? null;
    return { reading: 'live', kind: { id: pick.kindId, name: kind.name, held }, plannedKind: null, confidence };
  }
  const planned = place.options.find((o): o is Extract<KindOption, { live: false }> => !o.live && o.slug === pick.plannedKind);
  if (!planned) return null;
  return {
    reading: 'planned', kind: null, confidence,
    plannedKind: { slug: planned.slug, name: planned.name, issue: planned.issue, belongs: place.answers[planned.slug] ?? null },
  };
}

/** Jev's pick, from the option key it answered with. */
function pickOf(choice: string, options: readonly KindOption[]): KindReading | null {
  if (choice === NO_KIND) return { reading: 'none' };
  const option = options.find(o => optionKey(o) === choice);
  if (!option) return null;
  return option.live ? { reading: 'live', kindId: option.kindId } : { reading: 'planned', plannedKind: option.slug };
}

/** The stored reading, as a pick; null for an answer the client refused. */
function storedPick(stored: NonNullable<PlaceRow['stored']>): KindReading | null {
  if (stored.reading === 'live' && stored.kindId !== null) return { reading: 'live', kindId: stored.kindId };
  if (stored.reading === 'planned' && stored.plannedKind !== null) return { reading: 'planned', plannedKind: stored.plannedKind };
  return stored.reading === 'none' ? { reading: 'none' } : null;
}

/**
 * Record one call under the place's lock; whether its answer is about the
 * place and the kinds as they stand and the place is still arriving.
 */
async function store(experienceId: number, record: KindSuggestionRecord): Promise<boolean> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const locked = await lockExperience(client, experienceId);
    const current = locked ? await recordKindSuggestion(client, locked.lock, record) : false;
    const asked = current && (await client.query(
      `SELECT 1 FROM experiences e WHERE e.id = $1 AND ${STILL_ARRIVING}`, [experienceId],
    )).rowCount === 1;
    await client.query('COMMIT');
    return asked;
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

/**
 * A new reading: the lead read, Jev asked, the answer recorded. Null where
 * there is none to show — a lead that could not be read, an answer refused,
 * an answer about a place a run changed meanwhile, or a call that failed.
 */
async function readKind(id: number, place: PlaceRow): Promise<Suggestion | null> {
  let lead: string | null;
  try {
    lead = await articleLead(place.asked.article);
  } catch (error) {
    // The lead decides many readings, and a reading is kept for the place as
    // long as it stands: asked without it, it would be kept without it.
    console.error('[jev] no article lead for experience %d:', id, error);
    return null;
  }
  const record = { asked: place.asked, lead };
  try {
    const answer = await askJevChoice(kindReadingQuestion(place.asked, place.options, lead));
    // The client holds the answer to the options sent, so the key names one of
    // them; one that named none would be refused as any other stray answer is.
    const pick = pickOf(answer.choice, place.options);
    if (!pick) throw new JevAnswerRefused(answer.model, answer.inputTokens);
    const current = await store(id, {
      ...record, pick, confidence: answer.confidence, probabilities: answer.probabilities,
      model: answer.model, inputTokens: answer.inputTokens,
    });
    // A run renamed the place, the register was reloaded, or a curator
    // answered the arrival during the call: recorded for what it cost, not shown.
    return current ? shown(place, pick, answer.confidence) : null;
  } catch (error) {
    // An answer the client refused was still paid for: recorded with no
    // pick, so the cost is counted and the same place is not asked again.
    if (error instanceof JevAnswerRefused) {
      await store(id, {
        ...record, pick: null, confidence: 0, probabilities: {}, model: error.model, inputTokens: error.inputTokens,
      }).catch(() => undefined);
    }
    // No reading: the card shows the arrival without one, exactly as on a
    // deployment without Jev.
    console.error('[jev] no kind reading for experience %d:', id, error);
    return null;
  }
}

export async function suggestKind(
  { params: { id }, caller }: { params: z.output<typeof idParamSchema>; caller: Express.User },
): Promise<KindSuggestion> {
  const place = await placeOf(id);
  if (!place) throw notFound('Experience not found');
  // Asked only of a place arriving for a curator: a call is paid for, and a
  // place already offered or refused is no question on any card.
  if (place.arrivingSourceIds.length === 0) return { configured: jevConfigured(), suggestion: null };
  await requireArrivalScope(caller, id, place.arrivingSourceIds);
  if (!jevConfigured()) return { configured: false, suggestion: null };
  // Asked already for the place and the kinds as they stand: Jev's reading,
  // or none where its answer was refused — either way not asked, nor paid for, again.
  if (place.stored) {
    const pick = storedPick(place.stored);
    return { configured: true, suggestion: pick ? shown(place, pick, Number(place.stored.confidence)) : null };
  }
  return { configured: true, suggestion: await readKind(id, place) };
}

export async function answerPlannedKind(
  { params: { id }, body, caller }: {
    params: z.output<typeof idParamSchema>; body: z.output<typeof plannedKindAnswerBodySchema>; caller: Express.User;
  },
): Promise<PlannedKindAnswered> {
  const read = await pool.query<{ arriving_source_ids: number[] | null; planned: boolean }>(
    `SELECT (SELECT array_agg(DISTINCT m.source_id ORDER BY m.source_id) FROM ${MEMBERSHIPS} m
              WHERE m.experience_id = e.id AND ${arrivalOpenSql('e', 'm')}) AS arriving_source_ids,
            EXISTS (SELECT 1 FROM coverage_kinds ck
                     WHERE ck.slug = $2 AND ck.status = 'proposed' AND ck.form = 'place') AS planned
       FROM experiences e WHERE e.id = $1`,
    [id, body.plannedKind],
  );
  const row = read.rows[0];
  if (!row) throw notFound('Experience not found');
  const sourceIds = row.arriving_source_ids ?? [];
  // The answer is given on the arrival's card, and a place no longer arriving has none.
  if (sourceIds.length === 0) throw createError('The place is not arriving any more', 409);
  await requireArrivalScope(caller, id, sourceIds);
  if (!row.planned) throw badRequest('No such planned kind');

  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const locked = await lockExperience(client, id);
    if (!locked) throw notFound('Experience not found');
    await recordPlannedKindAnswer(client, locked.lock, { plannedKind: body.plannedKind, belongs: body.belongs, curatorId: caller.id });
    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
  return { experienceId: id, plannedKind: body.plannedKind, belongs: body.belongs };
}
