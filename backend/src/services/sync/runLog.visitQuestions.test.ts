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

  it('says how many places it left for the next run when the map or Wikipedia did not answer for them', () => {
    expect(visitQuestionsSentence({ read: 935, short: 40, asked: 3, unread: 200 })).toBe('; places with nothing to see: '
      + '3 asked of a curator, of 40 that fewer than two witnesses vouch for among 935 read, '
      + '200 left for the next run as OpenStreetMap or Wikipedia did not answer');
  });

  it('says the asking failed, whatever failed, without naming a source', () => {
    expect(visitQuestionsSentence({ read: 0, short: 0, asked: 0, failed: true }))
      .toBe('; places with nothing to see: not asked, the step failed (see the backend log) — the next run asks');
  });

  it('says nothing where it read nothing', () => {
    expect(visitQuestionsSentence(undefined)).toBe('');
    expect(visitQuestionsSentence({ read: 0, short: 0, asked: 0 })).toBe('');
  });
});
