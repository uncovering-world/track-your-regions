/**
 * Jev, TypeSafe's model for structured decisions (Epic #929), asked one closed
 * question at a time (#1260, ADR-0087: it suggests, a curator decides).
 *
 * Optional: a deployment without `JEV_API_KEY` asks nothing and shows no
 * suggestion, and nothing else changes. What is sent is catalogue data only —
 * a place's name, its country and kinds, each source's value, a picture's file
 * name and credit, a coordinate — and never anything about a user. Jev answers
 * a `choice` with the option it picks, a probability per option and a
 * confidence; a curator decides, and the answer is never applied on its own.
 *
 * Priced per input token, output free: `JEV_USD_PER_MILLION_INPUT_TOKENS`, as
 * published on 2026-10-08 for `jev-1.13.0`, which `jev-latest` names.
 */

import { userAgent } from '../../config/userAgent.js';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const TIMEOUT_MS = 15_000;

/** What one million input tokens cost, in US dollars (docs.typesafe.ai/models). */
export const JEV_USD_PER_MILLION_INPUT_TOKENS = 0.042;

/** Whether this deployment can ask Jev at all. */
export function jevConfigured(): boolean {
  return Boolean(process.env.JEV_API_KEY?.trim());
}

/** One closed question: the place as data, what to decide, and the options with what each means. */
export interface JevChoiceQuestion {
  state: Record<string, unknown>;
  instructions: string;
  /** Option key → what that option is, in words Jev reads. */
  criteria: Record<string, string>;
}

export interface JevChoiceAnswer {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
  model: string;
  inputTokens: number;
}

/**
 * An answer Jev gave and the client refused — an option it was not given, a
 * confidence that is no probability. The call was still made and paid for, so
 * it carries what it cost.
 */
export class JevAnswerRefused extends Error {
  constructor(readonly model: string, readonly inputTokens: number) {
    super('Jev answered outside the options it was given');
  }
}

interface SystemOneResponse {
  model?: string;
  answers?: Record<string, { choice?: string; probabilities?: Record<string, number>; confidence?: number }>;
  usage?: { input_tokens?: number };
}

/**
 * Ask one `choice` question. Throws on a refused or malformed answer: the
 * caller shows no suggestion then, as it does when Jev is not configured.
 */
export async function askJevChoice(question: JevChoiceQuestion): Promise<JevChoiceAnswer> {
  const key = process.env.JEV_API_KEY?.trim();
  if (!key) throw new Error('Jev is not configured');
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': userAgent(),
    },
    body: JSON.stringify({
      model: MODEL,
      state: question.state,
      questions: { pick: { type: 'choice', instructions: question.instructions, criteria: question.criteria } },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Jev answered ${response.status}`);
  const body = await response.json() as SystemOneResponse;
  const answer = body.answers?.pick;
  // The model's name is Jev's word, held to what the table keeps.
  const model = (typeof body.model === 'string' ? body.model : MODEL).slice(0, 40);
  const inputTokens = body.usage?.input_tokens ?? 0;
  // The answer is untrusted: an option it was not given, or a confidence that
  // is not a probability, is no answer — refused here rather than by the
  // table's CHECK, and refused with what the call cost.
  const { confidence } = answer ?? {};
  if (!answer?.choice || !Object.hasOwn(question.criteria, answer.choice)
    || typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new JevAnswerRefused(model, inputTokens);
  }
  return {
    choice: answer.choice,
    probabilities: answer.probabilities ?? {},
    confidence,
    model,
    inputTokens,
  };
}
