import { describe, it, expect } from 'vitest';
import {
  ADDITION_REASON_CODES, CURATION_REASON_CODES, CURATION_REASON_WORDS, GONE_REASON_CODES, REFUSAL_REASON_CODES,
  REGION_REFUSAL_REASON_CODES, SOURCE_ANSWER_REASON_CODES, STANDS_REASON_CODES,
} from './curationLog.js';

describe('the reasons a curator gives (#863)', () => {
  it('words every reason in a few words of sentence case, with no full stop', () => {
    for (const code of CURATION_REASON_CODES) {
      const words = CURATION_REASON_WORDS[code];
      expect(words.split(' ').length, code).toBeLessThanOrEqual(6);
      expect(words[0], code).toBe(words[0].toUpperCase());
      expect(words.endsWith('.'), code).toBe(false);
    }
  });

  it('offers other on every surface, so no act is left without an answer', () => {
    for (const surface of [
      REFUSAL_REASON_CODES, REGION_REFUSAL_REASON_CODES, ADDITION_REASON_CODES, SOURCE_ANSWER_REASON_CODES,
      GONE_REASON_CODES, STANDS_REASON_CODES,
    ]) {
      expect(surface).toContain('other');
    }
  });

  it('offers a region act only the reasons about where a place stands', () => {
    expect(REGION_REFUSAL_REASON_CODES).not.toContain('not-this-kind');
    expect(REGION_REFUSAL_REASON_CODES).not.toContain('not-one-place');
    expect(REGION_REFUSAL_REASON_CODES).toContain('wrong-place');
  });

  it('offers a place recorded as gone and one taken back reasons of their own direction', () => {
    // Nelson's Pillar, which the gone rule missed, and Ponte Santa Trinita, rebuilt after 1944.
    expect(GONE_REASON_CODES).toContain('missing-from-rule');
    for (const code of ['never-gone', 'rebuilt'] as const) {
      expect(GONE_REASON_CODES).not.toContain(code);
      expect(STANDS_REASON_CODES).toContain(code);
    }
  });
});
