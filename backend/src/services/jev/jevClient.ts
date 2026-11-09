/**
 * Jev, TypeSafe's model for structured decisions (Epic #929), asked closed
 * questions (#1260, ADR-0087: it suggests, a curator decides).
 *
 * Optional: a deployment without `JEV_API_KEY` asks nothing and shows no
 * suggestion, and nothing else changes. What is sent is catalogue data only —
 * a place's name, its country and kinds, each source's value, a picture's file
 * name and credit, a coordinate, a component and the item found beside it —
 * and never anything about a user. Jev answers a `choice` with the option it
 * picks, a probability per option and a confidence; a curator decides, and
 * the answer is never applied on its own.
 *
 * One ask carries one question or many (`askJevChoices`): the service's own
 * guidance is to batch the questions of one decision into one call, which is
 * cheaper and faster than one call each, so a card's candidates (#1272) go
 * together, a question per candidate, in one call where Jev's context holds
 * them and otherwise in as many as it needs (`callsFor`, #2398), none of them
 * longer than the context. A 429 or a 529 is backed off from
 * once, as the service asks, after the delay it names or a short one of our
 * own; a second refusal ends the call.
 *
 * Priced per input token, output free: `JEV_USD_PER_MILLION_INPUT_TOKENS`, as
 * published on 2026-10-08 for `jev-1.13.0`, which `jev-latest` names.
 */

import { userAgent } from '../../config/userAgent.js';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const TIMEOUT_MS = 15_000;
/** The pause before the one retry a 429 or a 529 gets, where the service names none. */
const BACKOFF_MS = 2_000;
/**
 * The longest pause a retry may take: the call is inside a curator's request
 * for a suggestion the card treats as optional, so a service naming a longer
 * delay gets no retry and the card shows none.
 */
const BACKOFF_CAP_MS = 5_000;
const BACKED_OFF = new Set([429, 529]);
/**
 * What one call is filled to, in tokens by `estimatedTokens`: Jev reads 64k
 * per request, the state and every question together (docs.typesafe.ai,
 * models, `jev-latest`), and refuses a longer one with a 400. The margin
 * covers the estimate's error and what Jev adds of its own to every call:
 * on the development catalogue on 2026-11-09 a call of one hint cost about
 * 600 tokens and each further hint about 310.
 */
const CALL_BUDGET_TOKENS = 40_000;
/**
 * UTF-8 bytes per token in the estimate: three, under English JSON's four or
 * so, which is what the callers send — English instructions with short
 * labels in any script. A call mostly in Arabic (two bytes a character) or
 * Japanese (three) would be underestimated, since a character there takes a
 * token or more; the gap between `CALL_BUDGET_TOKENS` and Jev's 64k covers
 * the labels among the English, not such a call.
 */
const BYTES_PER_TOKEN = 3;

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

/** One of several `choice` questions in a call: what to decide, and the options with what each means. */
export interface JevChoiceAsked {
  instructions: string;
  criteria: Record<string, string>;
}

/** What one question in a call came back with: an answer, or one the client refused. */
export type JevChoiceOutcome =
  | { choice: string; probabilities: Record<string, number>; confidence: number }
  | { refused: true };

/** The answers of one ask, over every call it took, keyed as the questions were, with what the calls cost. */
export interface JevChoicesAnswer {
  answers: Record<string, JevChoiceOutcome>;
  model: string;
  inputTokens: number;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The delay the service names on a refusal, in milliseconds, or null where it names none readable. */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  const seconds = header === null ? NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

async function send(key: string, body: string): Promise<Response> {
  const request = () => fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': userAgent(),
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const first = await request();
  if (!BACKED_OFF.has(first.status)) return first;
  const pause = retryAfterMs(first) ?? BACKOFF_MS;
  if (pause > BACKOFF_CAP_MS) return first;
  await delay(pause);
  return request();
}

/** One answer as the service sent it, held to the options it was given, or refused. */
function outcomeOf(
  asked: JevChoiceAsked, answer: SystemOneResponse['answers'] extends Record<string, infer A> | undefined ? A | undefined : never,
): JevChoiceOutcome {
  // The answer is untrusted: an option it was not given, or a confidence that
  // is not a probability, is no answer — refused here rather than by the
  // table's CHECK.
  const { confidence } = answer ?? {};
  if (!answer?.choice || !Object.hasOwn(asked.criteria, answer.choice)
    || typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { refused: true };
  }
  return { choice: answer.choice, probabilities: answer.probabilities ?? {}, confidence };
}

/** A rough count of the tokens `value` takes, from the bytes of its JSON (`BYTES_PER_TOKEN`). */
function estimatedTokens(value: unknown): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / BYTES_PER_TOKEN);
}

/**
 * The questions of one decision as calls Jev's context holds: in their order,
 * each call filled with the state and as many questions as stay within
 * `CALL_BUDGET_TOKENS`, and a question too long for any call alone in one, so
 * Jev refuses it alone. The Rock Art of the Mediterranean Basin's 238 hints,
 * one call some 74k tokens long before and refused, go in several.
 */
export function callsFor(
  state: Record<string, unknown>, questions: Record<string, JevChoiceAsked>,
): Array<Record<string, JevChoiceAsked>> {
  const base = estimatedTokens(state);
  const calls: Array<Record<string, JevChoiceAsked>> = [];
  let current: Record<string, JevChoiceAsked> = {};
  let filled = base;
  for (const [id, asked] of Object.entries(questions)) {
    const size = estimatedTokens({ [id]: { type: 'choice', ...asked } });
    if (Object.keys(current).length > 0 && filled + size > CALL_BUDGET_TOKENS) {
      calls.push(current);
      current = {};
      filled = base;
    }
    current[id] = asked;
    filled += size;
  }
  if (Object.keys(current).length > 0) calls.push(current);
  return calls;
}

/** One call to Jev with these questions over the state, or a throw where the call fails. */
async function askOneCall(
  key: string, state: Record<string, unknown>, questions: Record<string, JevChoiceAsked>,
): Promise<JevChoicesAnswer> {
  const response = await send(key, JSON.stringify({
    model: MODEL,
    state,
    questions: Object.fromEntries(Object.entries(questions).map(([id, asked]) => [
      id, { type: 'choice', instructions: asked.instructions, criteria: asked.criteria },
    ])),
  }));
  if (!response.ok) throw new Error(`Jev answered ${response.status}`);
  const body = await response.json() as SystemOneResponse;
  // The model's name is Jev's word, held to what the table keeps.
  const model = (typeof body.model === 'string' ? body.model : MODEL).slice(0, 40);
  const inputTokens = body.usage?.input_tokens ?? 0;
  const answers = Object.fromEntries(Object.entries(questions).map(([id, asked]) => [id, outcomeOf(asked, body.answers?.[id])]));
  return { answers, model, inputTokens };
}

/**
 * Ask several `choice` questions over one state, in as many calls as Jev's
 * context needs (`callsFor`), one after another so a curator's request makes
 * no burst. The answers come back keyed as the questions were, and what the
 * calls cost added up. Throws where a call fails, and asks nothing after it:
 * the caller stores no answer then, so the next request asks again. A
 * question the service answered outside its options comes back refused
 * rather than failing the others, since the call was made and paid for
 * whatever each answer was.
 */
export async function askJevChoices(
  state: Record<string, unknown>, questions: Record<string, JevChoiceAsked>,
): Promise<JevChoicesAnswer> {
  const key = process.env.JEV_API_KEY?.trim();
  if (!key) throw new Error('Jev is not configured');
  const answered: JevChoicesAnswer = { answers: {}, model: MODEL, inputTokens: 0 };
  for (const [i, call] of callsFor(state, questions).entries()) {
    const one = await askOneCall(key, state, call);
    Object.assign(answered.answers, one.answers);
    answered.inputTokens += one.inputTokens;
    if (i === 0) answered.model = one.model;
  }
  return answered;
}

/**
 * Ask one `choice` question. Throws on a refused or malformed answer: the
 * caller shows no suggestion then, as it does when Jev is not configured.
 */
export async function askJevChoice(question: JevChoiceQuestion): Promise<JevChoiceAnswer> {
  const { answers, model, inputTokens } = await askJevChoices(question.state, {
    pick: { instructions: question.instructions, criteria: question.criteria },
  });
  const answer = answers.pick;
  // Refused with what the call cost, so the caller records it.
  if (!answer || 'refused' in answer) throw new JevAnswerRefused(model, inputTokens);
  return { ...answer, model, inputTokens };
}
