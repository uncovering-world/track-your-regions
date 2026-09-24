import { describe, expect, it } from 'vitest';
import { auditOf, enrichmentsOf } from './wvImportChildReviewRows.js';

// Albania's two regions in the development import are Northeastern Albania
// (Q14201440) and Southeastern Albania; the other names are the kind of
// change an audit proposes.
describe('the audit of a region\'s children', () => {
  it('reads an addition by its name and a removal or rename by the child it is on', () => {
    const audit = auditOf({
      actions: [
        { type: 'add', name: 'Central Albania', reason: 'listed on the page' },
        { type: 'remove', childName: 'Albanian Riviera', reason: 'not a region on the page' },
        { type: 'rename', childName: 'Northeast Albania', newName: 'Northeastern Albania', reason: 'page title', confidence: 'high' },
      ],
      analysis: 'Two of three listed regions are present.',
    });
    expect(audit).toEqual({
      actions: [
        { type: 'add', name: 'Central Albania', reason: 'listed on the page' },
        { type: 'remove', name: 'Albanian Riviera', reason: 'not a region on the page' },
        { type: 'rename', name: 'Northeast Albania', newName: 'Northeastern Albania', reason: 'page title' },
      ],
      analysis: 'Two of three listed regions are present.',
    });
  });

  it('leaves out an action of another type, one naming no child and a rename to nothing', () => {
    const audit = auditOf({
      actions: [
        { type: 'merge', childName: 'Northeastern Albania' },
        { type: 'add', childName: 'Central Albania' },
        { type: 'rename', childName: 'Northeastern Albania', newName: '  ' },
        'Southeastern Albania',
      ],
    });
    expect(audit).toEqual({ actions: [], analysis: '' });
  });

  it('reads a reply that is not an object as no actions', () => {
    expect(auditOf(['add Central Albania'])).toEqual({ actions: [], analysis: '' });
  });
});

describe('the enrichment of a region\'s children', () => {
  it('keeps a Wikidata id only where it is a Q number', () => {
    expect(enrichmentsOf({
      enrichments: [
        { name: 'Northeastern Albania', wikivoyageTitle: 'Northeastern Albania', wikidataQID: 'Q14201440' },
        { name: 'Southeastern Albania', wikivoyageTitle: 'Southeastern Albania', wikidataQID: 'unknown' },
        { name: 'Central Albania', wikivoyageTitle: '', wikidataQID: null },
        { wikivoyageTitle: 'Tirana' },
      ],
    })).toEqual([
      { name: 'Northeastern Albania', wikivoyageTitle: 'Northeastern Albania', wikidataQID: 'Q14201440' },
      { name: 'Southeastern Albania', wikivoyageTitle: 'Southeastern Albania', wikidataQID: null },
      { name: 'Central Albania', wikivoyageTitle: null, wikidataQID: null },
    ]);
  });
});
