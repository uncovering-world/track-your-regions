/**
 * Asking Jev what a visitor finds at a place, and recording the answer
 * (#1768, #1770, ADR-0087): the arrival's card asks it of a place arriving for
 * a curator (`visitSuggestionController.ts`), and a kind's run asks it of a
 * place it offers that few witnesses vouch for (`visitQuestions.ts`).
 * The question is `visitReading.ts`'s, the record `visitSuggestions.ts`'s.
 */

import { pool, rollbackQuietly } from '../../../db/index.js';
import { lockExperience } from '../../../db/experienceWriter.js';
import { askJevChoice, JevAnswerRefused } from '../../jev/jevClient.js';
import { articleLead, visitQuestion, type VisitAsked, type VisitReading } from './visitReading.js';
import { recordVisitSuggestion, type VisitSuggestion } from './visitSuggestions.js';

/** A reading as a card shows it and a run weighs it. */
export interface Reading {
  reading: VisitReading;
  confidence: number;
}

/**
 * What a caller still asks of the place `e` under the lock, as SQL: the card
 * that it is arriving, the run nothing.
 */
export type StillAsked = (e: string) => string;

/**
 * Record one call under the place's lock; whether its answer is about the
 * place as it stands and the place is still what the caller asks about: a
 * place a run stopped finding, or a curator answered, during the call is no
 * card's question.
 */
async function store(experienceId: number, suggestion: VisitSuggestion, stillAsked: StillAsked): Promise<boolean> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const locked = await lockExperience(client, experienceId);
    const current = locked ? await recordVisitSuggestion(client, locked.lock, suggestion) : false;
    const asked = current && (await client.query(
      `SELECT 1 FROM experiences e WHERE e.id = $1 AND ${stillAsked('e')}`, [experienceId],
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
export async function readVisit(id: number, asked: VisitAsked, stillAsked: StillAsked): Promise<Reading | null> {
  let lead: string | null;
  try {
    lead = await articleLead(asked.article);
  } catch (error) {
    // The lead decides most readings (`visitReading.ts`), and a reading is kept
    // for the place as long as it stands: asked without the lead it would be
    // kept without it. Nothing is asked or recorded; the next ask tries again.
    console.error('[jev] no article lead for experience %d:', id, error);
    return null;
  }
  try {
    const answer = await askJevChoice(visitQuestion(asked, lead));
    const reading = answer.choice as VisitReading;
    const current = await store(id, {
      reading, confidence: answer.confidence, probabilities: answer.probabilities,
      model: answer.model, inputTokens: answer.inputTokens, asked, lead,
    }, stillAsked);
    // A run renamed the place or moved it into another kind during the call:
    // the answer is about a place nobody sees now — recorded for what it
    // cost, not shown, and the next ask is about the new one.
    return current ? { reading, confidence: answer.confidence } : null;
  } catch (error) {
    // An answer the client refused was still paid for: recorded with no
    // reading, so the cost is counted and the same place is not asked again.
    if (error instanceof JevAnswerRefused) {
      await store(id, {
        reading: null, confidence: 0, probabilities: {}, model: error.model,
        inputTokens: error.inputTokens, asked, lead,
      }, stillAsked).catch(() => undefined);
    }
    // No reading: the place is shown or weighed without one, exactly as on a
    // deployment without Jev.
    console.error('[jev] no visit reading for experience %d:', id, error);
    return null;
  }
}
