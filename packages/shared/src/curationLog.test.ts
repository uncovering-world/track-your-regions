import { describe, it, expect } from 'vitest';
import {
  ADDITION_REASON_CODES, CURATION_REASON_CODES, CURATION_REASON_WORDS, REFUSAL_REASON_CODES, SOURCE_ANSWER_REASON_CODES,
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
    for (const surface of [REFUSAL_REASON_CODES, ADDITION_REASON_CODES, SOURCE_ANSWER_REASON_CODES]) {
      expect(surface).toContain('other');
    }
  });
});
