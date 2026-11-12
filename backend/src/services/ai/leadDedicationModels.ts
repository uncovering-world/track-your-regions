/**
 * The two language models that read a monument's dedication from the lead of
 * its English Wikipedia article (#2472, ADR-0201): Claude Haiku through
 * Anthropic's API and an OpenAI model (`lead_dedication` in AI Settings,
 * gpt-5-mini unless an admin picks another), each asked alone and answering in
 * a fixed JSON shape (structured outputs). Two providers, so that an answer
 * one model gives the other does not is no answer: the reading
 * (`places/leadDedication.ts`) writes a dedication only where both name the
 * same linked article.
 *
 * Optional, as Jev is (ADR-0087): a deployment without `ANTHROPIC_API_KEY` or
 * without `OPENAI_API_KEY` reads no lead, and nothing else changes. What is
 * sent is catalogue data only, a place's name and the lead of its article,
 * never anything about a user.
 *
 * Each model counts its calls and tokens, and the pass logs them once per
 * model to the AI usage log (`logUsage`), priced by `pricingService` for
 * OpenAI's model and by `CLAUDE_USD_PER_MILLION_TOKENS` for Claude's, which
 * that service's OpenAI price list does not hold.
 */

import Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { getModelForFeature } from './aiSettingsService.js';
import { logAIUsage } from './aiUsageLogger.js';
import { chatCompletion, DEFAULT_AI_TIMEOUT_MS } from './chatCompletion.js';
import { getOpenAIClient, UNTRUSTED_DATA_RULE } from './openaiShared.js';
import { calculateCost } from './pricingService.js';

/** The feature the OpenAI model is configured and its usage logged under. */
export const LEAD_DEDICATION_FEATURE = 'lead_dedication';

/** Claude's half of the pair, the model #2472 was measured with. */
export const CLAUDE_LEAD_MODEL = 'claude-haiku-5-5';

/** What a million tokens of Claude Haiku 5.5 cost, in US dollars, for prompts up to 100k tokens (Anthropic's price list, 2026-11). */
export const CLAUDE_USD_PER_MILLION_TOKENS = { input: 0.1, output: 0.5 } as const;

/**
 * The most a model may write, its reasoning included: the measured answers
 * took about 400 tokens from Claude and 800 from gpt-5-mini, most of them
 * reasoning, so a lead's answer is never cut short at this.
 */
const MAX_OUTPUT_TOKENS = 8000;

/** What the models are told, as #2472 measured it (the question is asked by `places/leadDedication.ts`). */
const MEASURED_INSTRUCTIONS = `You read the lead of a Wikipedia article about a monument, memorial or work of public art.
Links in the text are written ⟦anchor→Linked article title⟧.

Question: does the lead state, in words, whom or what the place was raised to commemorate, to honour,
to mark or to be dedicated to? If it does, which linked article is that subject?

Rules:
- Only a dedication the text states counts ("to commemorate", "in memory of", "dedicated to",
  "in honour of", "a memorial to", "to mark", and the same in any language). What a statue depicts
  is not a dedication unless the text says it was raised to honour or commemorate them.
- Not the maker, the sculptor, the architect, the owner, the place where it stands, the material,
  a title or office before a name, or the side that caused the deaths it remembers.
- Where the text names a group of people defined by an event (the victims of a massacre, the soldiers
  who fell in a battle, those killed in a war), the answer is the event, when the event is linked.
- If the subject is stated but not linked, answer "none" for link and write the subject in subject_text.
- If nothing is stated, stated=false and link "none".`;

/**
 * The instructions with the repository's rule that keeps the lead, which
 * anyone may edit, data rather than instructions. Built when asked, so a
 * module that stands in for `openaiShared.ts` need not carry the rule.
 */
export function leadInstructions(): string {
  return `${MEASURED_INSTRUCTIONS}\n${UNTRUSTED_DATA_RULE}`;
}

/** One question: the instructions, the place and its lead as data, and the JSON shape the answer must take. */
export interface StructuredQuestion {
  system: string;
  user: string;
  /** The shape's name, which OpenAI asks for. */
  name: string;
  schema: Record<string, unknown>;
}

/** One of the two models, as the reading asks it. */
export interface DedicationModel {
  /** The model's id, under which its answers are kept. */
  readonly model: string;
  /** The model's answer as parsed JSON, or null where it gave none it could be read from (a refusal, a cut answer). */
  ask(question: StructuredQuestion): Promise<unknown>;
  /** Logs the calls asked since the last log as one row of the AI usage log; nothing where none was. */
  logUsage(description: string): Promise<void>;
}

/** A model's tally of calls and tokens since its usage was last logged. */
class Tally {
  calls = 0;
  promptTokens = 0;
  completionTokens = 0;

  add(promptTokens: number, completionTokens: number): void {
    this.calls++;
    this.promptTokens += promptTokens;
    this.completionTokens += completionTokens;
  }

  /** Logs the tally under `model`, priced by `cost`, and starts it again. */
  async log(model: string, description: string, cost: (prompt: number, completion: number) => number): Promise<void> {
    if (!this.calls) return;
    const { calls, promptTokens, completionTokens } = this;
    this.calls = 0;
    this.promptTokens = 0;
    this.completionTokens = 0;
    await logAIUsage({
      feature: LEAD_DEDICATION_FEATURE, model, description, apiCalls: calls, promptTokens, completionTokens,
      totalCost: cost(promptTokens, completionTokens),
    }).catch((error: unknown) => console.warn(`[Lead dedication] usage of ${model} not logged: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/** The JSON a model wrote, or null where it is none. */
function parsed(text: string | null | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Claude, asked through Anthropic's Messages API with the answer's shape as its output format. */
export function claudeModel(client: Anthropic): DedicationModel {
  const tally = new Tally();
  return {
    model: CLAUDE_LEAD_MODEL,
    async ask({ system, user, schema }) {
      const message = await client.messages.create({
        model: CLAUDE_LEAD_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { format: { type: 'json_schema', schema } },
      });
      tally.add(message.usage.input_tokens, message.usage.output_tokens);
      // A refusal or an answer cut at the limit holds no JSON to read.
      if (message.stop_reason !== 'end_turn') return null;
      return parsed(message.content.find((block): block is Anthropic.TextBlock => block.type === 'text')?.text);
    },
    logUsage: (description) => tally.log(CLAUDE_LEAD_MODEL, description, (prompt, completion) =>
      (prompt * CLAUDE_USD_PER_MILLION_TOKENS.input + completion * CLAUDE_USD_PER_MILLION_TOKENS.output) / 1_000_000),
  };
}

/** An OpenAI model, asked through Chat Completions with the answer's shape as a strict JSON schema. */
export function openaiModel(client: OpenAI, model: string): DedicationModel {
  const tally = new Tally();
  return {
    model,
    async ask({ system, user, name, schema }) {
      const response = await chatCompletion(client, {
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
        max_completion_tokens: MAX_OUTPUT_TOKENS,
      });
      tally.add(response.usage?.prompt_tokens ?? 0, response.usage?.completion_tokens ?? 0);
      const choice = response.choices[0];
      return choice?.finish_reason === 'stop' ? parsed(choice.message.content) : null;
    },
    logUsage: (description) => tally.log(model, description, (prompt, completion) => calculateCost(prompt, completion, model).totalCost),
  };
}

/**
 * The two models, Claude's first, or null where this deployment lacks either
 * key: an answer only one provider gives is never written, so one alone is
 * not asked.
 */
export async function leadDedicationModels(): Promise<DedicationModel[] | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  const openai = getOpenAIClient();
  if (!key || !openai) return null;
  const claude = new Anthropic({ apiKey: key, timeout: DEFAULT_AI_TIMEOUT_MS, maxRetries: 4 });
  return [claudeModel(claude), openaiModel(openai, await getModelForFeature(LEAD_DEDICATION_FEATURE))];
}
