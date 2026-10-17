/**
 * How far a long admin operation is (#1356), in one shape every such operation
 * reports through:
 * - the step it is on, as "N of M" with its sentence;
 * - how much of that step is done, of how much;
 * - how long the whole has run;
 * - whether an outside service is holding it, and for how long.
 *
 * Each step's start and end, and the outcome, is also one line in the backend
 * log under the operation's prefix; a wait is logged by the retry loop that
 * waits. A run that lasts
 * minutes is therefore never silent there, and an admin reading the panel and
 * a developer reading the log see the same steps.
 */

import { elapsedText } from '@tyr/shared/durations';
import type { OperationProgressAnswer } from '../api/responses/operation.js';

export interface OperationStep {
  /** 1-based, of `count`: a step a run skips is not announced, so N can jump. */
  index: number;
  count: number;
  sentence: string;
  done: number;
  /** 0 while the step cannot say how much it has to do: the bar is then indeterminate. */
  total: number;
  startedAt: number;
}

export interface OperationWait {
  /** The wait in the words the panel shows: who is holding the run, and why. */
  sentence: string;
  until: number;
}

export interface OperationProgress {
  startedAt: number;
  step: OperationStep | null;
  wait: OperationWait | null;
  /** A cancel was asked: the run stops at the next point it can, usually when the step in flight ends. */
  cancelling: boolean;
}

/**
 * The progress as a status answer carries it (`OperationProgressAnswer`): times
 * as seconds elapsed on the server's clock.
 */
export function operationAnswer(progress: OperationProgress, now = Date.now()): OperationProgressAnswer {
  const seconds = (since: number) => Math.max(0, Math.round((now - since) / 1000));
  const { step, wait } = progress;
  return {
    elapsedSeconds: seconds(progress.startedAt),
    cancelling: progress.cancelling,
    step: step && {
      index: step.index, count: step.count, sentence: step.sentence, done: step.done, total: step.total,
      elapsedSeconds: seconds(step.startedAt),
    },
    // A wait that has run out is over, whether or not an answer has come since:
    // a step whose answers advance nothing (one long query) would otherwise go
    // on showing it.
    wait: wait && wait.until > now ? { sentence: wait.sentence, secondsLeft: Math.round((wait.until - now) / 1000) } : null,
  };
}

export class Operation {
  readonly progress: OperationProgress;

  constructor(
    private readonly prefix: string,
    private readonly steps: number,
    private readonly log: (line: string) => void = console.log,
    private readonly now: () => number = Date.now,
  ) {
    this.progress = { startedAt: now(), step: null, wait: null, cancelling: false };
  }

  /** Close the step running and open step `index` of the operation's count. */
  step(index: number, sentence: string, total = 0): void {
    this.closeStep();
    this.progress.wait = null;
    this.progress.step = { index, count: this.steps, sentence, done: 0, total, startedAt: this.now() };
    const toDo = total > 0 ? ` (${total} to do)` : '';
    this.log(`${this.prefix} Step ${index} of ${this.steps}: ${sentence}${toDo}`);
  }

  /** `n` more of the current step done; an answer also ends a wait. */
  advance(n = 1): void {
    this.progress.wait = null;
    if (this.progress.step) this.progress.step.done += n;
  }

  /**
   * An outside service is holding the run for `ms`. Not logged here: the code
   * that waits logs it under the run's prefix before it waits, the retry loop
   * (`sourceRetry.ts`) or a hold another run earned (`heldByService`).
   */
  waiting(sentence: string, ms: number): void {
    this.progress.wait = { sentence, until: this.now() + ms };
  }

  /** A cancel was asked; the run's own loop is what stops it. */
  cancel(): void {
    this.progress.cancelling = true;
    this.log(`${this.prefix} Cancel asked; stopping at the next point the run can`);
  }

  /** A line of the operation's own under its prefix, for a count a step's end line does not split. */
  note(line: string): void {
    this.log(`${this.prefix} ${line}`);
  }

  /** The operation is over, whatever its outcome: the sentence says which. */
  finish(outcome: string): void {
    this.closeStep();
    this.progress.wait = null;
    this.log(`${this.prefix} Finished after ${elapsedText((this.now() - this.progress.startedAt) / 1000)}: ${outcome}`);
  }

  private closeStep(): void {
    const step = this.progress.step;
    if (!step) return;
    const counted = step.total > 0 ? `${step.done} of ${step.total}` : `${step.done}`;
    this.log(`${this.prefix} Step ${step.index} of ${step.count} done: ${counted} in ${elapsedText((this.now() - step.startedAt) / 1000)}`);
  }
}
