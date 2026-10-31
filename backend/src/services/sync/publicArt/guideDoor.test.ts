/**
 * The guide door's answers for Monuments & memorials (ADR-0167): what it says
 * of a candidate the line did not keep, open or shut, and the sentences a
 * curator reads. Whether the door is open is `places/guideDoor.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { belowLineUnguidedReason, guideDoorEntry, guideDoorNote, shutDoorNote } from './guideDoor.js';
import { belowLineReason } from '../sourceLine.js';

const LINE = { enterSitelinks: 22, staySitelinks: 18 };

describe('guideDoorEntry', () => {
  it('admits a candidate under the line a guide uses, with the curator\'s question', () => {
    // The Voortrekker Monument: 20 editions, used by a Wikivoyage guide.
    expect(guideDoorEntry(new Set(['Q963472']), 'Q963472', 20, 'out', LINE))
      .toEqual({ readershipNote: guideDoorNote(20, LINE) });
    expect(guideDoorNote(20, LINE)).toBe(
      'Admitted below the sitelinks line (20 Wikipedia editions, 22 to enter): a Wikivoyage guide uses it. '
      + 'Is it a monument a visitor goes to see?',
    );
  });

  it('says nothing of a candidate never in that no guide uses, which the line decides', () => {
    expect(guideDoorEntry(new Set(['Q963472']), 'Q2', 20, 'out', LINE)).toBeNull();
  });

  it('keeps a held row under the stay line while a guide uses it, and lets it fall with the guide named once none does', () => {
    expect(guideDoorEntry(new Set(['Q5']), 'Q5', 17, 'fell', LINE)).toEqual({ readershipNote: guideDoorNote(17, LINE) });
    expect(guideDoorEntry(new Set(['Q5']), 'Q4', 17, 'fell', LINE)).toEqual({ fell: belowLineUnguidedReason(17, LINE) });
    // The catalogue's one sentence for a fallen row, with the guide added (#884).
    expect(belowLineUnguidedReason(17, LINE)).toBe(`${belowLineReason(17, LINE)}, and no Wikivoyage guide uses it`);
  });

  it('shut, lets nothing in and keeps the held where they are', () => {
    expect(guideDoorEntry(null, 'Q963472', 20, 'out', LINE)).toBeNull();
    expect(guideDoorEntry(null, 'Q4', 17, 'fell', LINE)).toEqual({ readershipNote: shutDoorNote(17, LINE) });
    expect(shutDoorNote(17, LINE)).toBe(
      'Kept below the sitelinks line (17 Wikipedia editions, 18 to stay): '
      + "the guide door is shut (the source's curator gate is off, or no Wikivoyage usage is built)",
    );
  });
});
