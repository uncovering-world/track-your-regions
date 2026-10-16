import { describe, expect, it } from 'vitest';
import { spoken, stepName, StepTimes } from './stepTimes.js';

describe('the steps of a build (#1527)', () => {
  it('names a step by its message before a colon or a trailing ellipsis', () => {
    expect(stepName('Pass 2 of 2: writing 24,300,000 items...')).toBe('Pass 2 of 2');
    expect(stepName('Indexing...')).toBe('Indexing');
    expect(stepName('Throwing the trial\'s tables away...')).toBe('Throwing the trial\'s tables away');
  });

  it('times each step until the next starts, and a new message of the same step does not split it', () => {
    let now = 0;
    const steps = new StepTimes(() => now);
    expect(steps.phase('Pass 1 of 2: finding what the subset keeps...')).toBe(true);
    now = 30_000;
    expect(steps.phase('Pass 1 of 2: read from an earlier build of the file, 9 items')).toBe(false);
    now = 200_000;
    expect(steps.phase('Indexing...')).toBe(true);
    now = 7_400_000;
    expect(steps.summary()).toBe('Pass 1 of 2 3 min 20 s, Indexing 2 h 0 min');
  });

  it('leaves out a step that took under a second', () => {
    let now = 0;
    const steps = new StepTimes(() => now);
    steps.phase('Finding the newest complete file...');
    now = 300;
    steps.phase('Pass 1 of 2: finding what the subset keeps...');
    now = 60_300;
    expect(steps.summary()).toBe('Pass 1 of 2 1 min 0 s');
  });

  it('says nothing for a build that named no step', () => {
    expect(new StepTimes(() => 0).summary()).toBe('');
    expect(spoken(400)).toBe('0 s');
  });
});
