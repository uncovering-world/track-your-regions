import { describe, expect, it } from 'vitest';
import { Operation, operationAnswer } from './operationProgress.js';

function clocked() {
  let t = 1_000_000;
  const lines: string[] = [];
  const operation = new Operation('[Component items]', 12, line => lines.push(line), () => t);
  return { operation, lines, tick: (ms: number) => { t += ms; }, now: () => t };
}

describe('Operation', () => {
  it('logs each step as it opens and closes, with its counts and time', () => {
    const { operation, lines, tick } = clocked();
    operation.step(1, 'Reading the parts 812 site items name', 812);
    operation.advance(400);
    tick(14_000);
    operation.advance(412);
    operation.step(2, 'Reading the names of 9922 candidate items', 9922);
    tick(372_000);
    operation.finish('431 of 2,107 components without an item have a candidate');
    expect(lines).toEqual([
      '[Component items] Step 1 of 12: Reading the parts 812 site items name (812 to do)',
      '[Component items] Step 1 of 12 done: 812 of 812 in 14 s',
      '[Component items] Step 2 of 12: Reading the names of 9922 candidate items (9922 to do)',
      '[Component items] Step 2 of 12 done: 0 of 9922 in 6 min 12 s',
      '[Component items] Finished after 6 min 26 s: 431 of 2,107 components without an item have a candidate',
    ]);
  });

  it('holds a wait until the next answer, leaving its log line to the retry loop', () => {
    const { operation, lines } = clocked();
    operation.step(5, 'Looking near 1,204 points, 310 areas', 310);
    operation.waiting('Wikidata is not answering (HTTP 429) — retrying in 30s', 30_000);
    expect(operation.progress.wait?.sentence).toContain('HTTP 429');
    expect(lines).toHaveLength(1);
    operation.advance(10);
    expect(operation.progress.wait).toBeNull();
    expect(operation.progress.step?.done).toBe(10);
  });

  it('says a step with no total by its count alone', () => {
    const { operation, lines } = clocked();
    operation.step(1, 'Finding sites whose picture we may not show');
    operation.advance(143);
    operation.finish('every site already shows a picture');
    expect(lines[1]).toBe('[Component items] Step 1 of 12 done: 143 in 0 s');
  });
});

describe('a cancel', () => {
  it('is said on the progress and in the log at once, before the run stops', () => {
    const { operation, lines } = clocked();
    operation.step(2, 'Placing every point in the regions that contain it');
    operation.cancel();
    expect(operation.progress.cancelling).toBe(true);
    expect(lines.at(-1)).toBe('[Component items] Cancel asked; stopping at the next point the run can');
  });
});

describe('operationAnswer', () => {
  it('sends times as seconds elapsed on the server', () => {
    const { operation, tick, now } = clocked();
    tick(65_000);
    operation.step(3, 'Reading the classes of 1,640 resolved components', 1640);
    tick(20_000);
    operation.advance(800);
    operation.waiting('Wikidata asked to wait', 30_000);
    tick(10_000);
    expect(operationAnswer(operation.progress, now())).toEqual({
      elapsedSeconds: 95,
      cancelling: false,
      step: { index: 3, count: 12, sentence: 'Reading the classes of 1,640 resolved components', done: 800, total: 1640, elapsedSeconds: 30 },
      wait: { sentence: 'Wikidata asked to wait', secondsLeft: 20 },
    });
  });

  it('drops a wait that has run out, though no answer has come since', () => {
    const { operation, tick, now } = clocked();
    operation.step(3, 'Asking Commons who took 41 pictures');
    operation.waiting('Commons is not answering (HTTP 429) — retrying in 30s', 30_000);
    tick(30_000);
    expect(operationAnswer(operation.progress, now()).wait).toBeNull();
  });

  it('answers no step before the first one opens', () => {
    const { operation, now } = clocked();
    expect(operationAnswer(operation.progress, now())).toEqual({ elapsedSeconds: 0, cancelling: false, step: null, wait: null });
  });
});
