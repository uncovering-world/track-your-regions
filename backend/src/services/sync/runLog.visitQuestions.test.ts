import { describe, expect, it } from 'vitest';
import { visitQuestionsSentence } from './runLog.js';

describe("the run's closing line on places with nothing to see (#1770)", () => {
  it('says how many it asked of how many it read', () => {
    expect(visitQuestionsSentence({ read: 1011, short: 247, asked: 34 }))
      .toBe('; places with nothing to see: 34 asked of a curator, of 247 that fewer than two witnesses vouch for among 1011 read');
    expect(visitQuestionsSentence({ read: 1011, short: 247, asked: 34 }, true)).toContain('34 would be asked of a curator');
  });

  it('says when a Cancel stopped the asking', () => {
    expect(visitQuestionsSentence({ read: 1011, short: 247, asked: 12, stopped: true })).toMatch(/12 asked .*, stopped by Cancel$/);
  });

  it('says when a Cancel stopped the asking before any place was read', () => {
    expect(visitQuestionsSentence({ read: 0, short: 0, asked: 0, stopped: true }))
      .toBe('; places with nothing to see: stopped by Cancel before any was read');
  });

  it('says nothing where it read nothing', () => {
    expect(visitQuestionsSentence(undefined)).toBe('');
    expect(visitQuestionsSentence({ read: 0, short: 0, asked: 0 })).toBe('');
  });
});
