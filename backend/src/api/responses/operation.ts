/**
 * How far a long admin operation is, as every such operation's status answer
 * carries it (#1356): the shape `services/operationProgress.ts` keeps, with
 * its times sent as elapsed seconds the server measured, so the panel does not
 * depend on its own clock agreeing with the server's. `OperationProgressView`
 * draws it.
 *
 * Imports are held to the list in the header of `curation.ts` beside this file.
 */

import { z } from 'zod/v4';

export const OperationStepAnswer = z.strictObject({
  index: z.number().int().describe('1-based, of `count`. A step a run skips is not announced, so it can jump.'),
  count: z.number().int().nullable().describe('How many steps the run has; null where it cannot know ahead (a dump build names its steps as it goes).'),
  sentence: z.string().describe('What the step is doing, in the words the panel shows.'),
  done: z.number().int(),
  total: z.number().int().describe('0 while the step cannot say how much it has to do.'),
  elapsedSeconds: z.number().int(),
}).describe('The step an operation is on.');
export type OperationStepAnswer = z.infer<typeof OperationStepAnswer>;

export const OperationProgressAnswer = z.strictObject({
  elapsedSeconds: z.number().int().describe('Since the operation started.'),
  cancelling: z.boolean().describe('A cancel was asked: the run stops at the next point it can, usually when the step in flight ends.'),
  step: OperationStepAnswer.nullable(),
  wait: z.strictObject({
    sentence: z.string().describe('Who is holding the run, and why.'),
    secondsLeft: z.number().int(),
  }).nullable().describe('An outside service is holding the run: a rate limit or a retry.'),
}).describe('How far a long admin operation is.');
export type OperationProgressAnswer = z.infer<typeof OperationProgressAnswer>;
