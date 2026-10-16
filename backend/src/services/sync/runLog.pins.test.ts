import { describe, expect, it } from 'vitest';
import { pinsSentence } from './runLog.js';

describe("a run's closing line about the pins (#1370)", () => {
  it('says what the run asked again, agreed with and left standing', () => {
    expect(pinsSentence({ asked: 3, agreed: 41, standing: 2 })).toBe('; pins: 3 asked about again, 41 agreed with, 2 left as the curator answered');
    expect(pinsSentence({ asked: 0, agreed: 12, standing: 0 })).toBe('; pins: 0 asked about again, 12 agreed with');
  });

  it('says what a preview would have asked, since it asks nothing', () => {
    expect(pinsSentence({ asked: 3, agreed: 41, standing: 0 }, true)).toBe('; pins: 3 would be asked about again, 41 agreed with');
  });

  it('says nothing where the run read no pin', () => {
    expect(pinsSentence(undefined)).toBe('');
    expect(pinsSentence({ asked: 0, agreed: 0, standing: 0 })).toBe('');
  });
});
