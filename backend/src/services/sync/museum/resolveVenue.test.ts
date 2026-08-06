import { describe, it, expect } from 'vitest';
import { resolveVenue } from './resolveVenue.js';
import type { VenueFacts } from './venueTest.js';

const MUSEUM_CLASSES = new Set(['Q207694']); // art museum
const world: Record<string, VenueFacts & { parents: string[] }> = {
  // Department of Paintings of the Louvre: has coordinates, is not a venue, P361 -> Louvre
  Q3044768: { qid: 'Q3044768', classes: ['Q11681271'], lat: 48.86, lon: 2.33, dissolved: null, parents: ['Q19675'] },
  Q19675: { qid: 'Q19675', classes: ['Q207694'], lat: 48.86, lon: 2.33, dissolved: null, parents: [] },
  // Borghese Collection: two qualifying ancestors one hop up
  Q683074: { qid: 'Q683074', classes: ['Q7328910'], lat: null, lon: null, dissolved: null, parents: ['Q19675', 'Q841506'] },
  Q841506: { qid: 'Q841506', classes: ['Q207694'], lat: 41.9, lon: 12.5, dissolved: null, parents: [] },
  // a city: no qualifying ancestor anywhere
  Q239: { qid: 'Q239', classes: ['Q515'], lat: 50.8, lon: 4.3, dissolved: null, parents: [] },
  // Chain: entity -> skip -> skip -> venue at hop 2 (to test maxHops boundary)
  Q900000: { qid: 'Q900000', classes: ['Q7328910'], lat: null, lon: null, dissolved: null, parents: ['Q900001'] },
  Q900001: { qid: 'Q900001', classes: ['Q7328910'], lat: null, lon: null, dissolved: null, parents: ['Q900002'] },
  Q900002: { qid: 'Q900002', classes: ['Q207694'], lat: 45.0, lon: 10.0, dissolved: null, parents: [] },
  // Sibling ancestors at different hops: start has two parents, one qualifies immediately, other only at hop 2
  // Deep branch listed first to test breadth-first, not depth-first
  Q950000: { qid: 'Q950000', classes: ['Q7328910'], lat: null, lon: null, dissolved: null, parents: ['Q950001', 'Q950003'] },
  Q950001: { qid: 'Q950001', classes: ['Q7328910'], lat: null, lon: null, dissolved: null, parents: ['Q950002'] },
  Q950002: { qid: 'Q950002', classes: ['Q207694'], lat: 35.0, lon: 20.0, dissolved: null, parents: [] },
  Q950003: { qid: 'Q950003', classes: ['Q207694'], lat: 40.0, lon: 25.0, dissolved: null, parents: [] },
};
const facts = (q: string) => world[q];
const parents = (q: string) => world[q]?.parents ?? [];

describe('resolveVenue', () => {
  it('returns the entity itself when it passes', () => {
    expect(resolveVenue('Q19675', facts, parents, MUSEUM_CLASSES)).toEqual({ venue: 'Q19675', hops: 0 });
  });

  it('walks P361 up to the nearest qualifying ancestor', () => {
    expect(resolveVenue('Q3044768', facts, parents, MUSEUM_CLASSES)).toEqual({ venue: 'Q19675', hops: 1 });
  });

  it('refuses to choose between two qualifying ancestors at the same hop', () => {
    const r = resolveVenue('Q683074', facts, parents, MUSEUM_CLASSES);
    expect('unresolved' in r).toBe(true);
    expect((r as { unresolved: string }).unresolved).toContain('two qualifying ancestors');
  });

  it('gives up when nothing qualifies', () => {
    const r = resolveVenue('Q239', facts, parents, MUSEUM_CLASSES);
    expect('unresolved' in r).toBe(true);
  });

  it('respects maxHops boundary', () => {
    // Q900000 -> Q900001 -> Q900002 (venue)
    // With maxHops=1, it should not reach the venue at hop 2
    const r = resolveVenue('Q900000', facts, parents, MUSEUM_CLASSES, 1);
    expect('unresolved' in r).toBe(true);
  });

  it('finds venue within maxHops boundary', () => {
    // Q900000 -> Q900001 -> Q900002 (venue)
    // With maxHops=2, it should reach the venue at hop 2
    const r = resolveVenue('Q900000', facts, parents, MUSEUM_CLASSES, 2);
    expect(r).toEqual({ venue: 'Q900002', hops: 2 });
  });

  it('chooses nearest ancestor among siblings at different hop distances', () => {
    // Q950000 has two parents: Q950001 (leads to venue at hop 2) and Q950003 (is venue at hop 1)
    // Deep branch listed first to ensure breadth-first (not depth-first) returns the nearest
    const r = resolveVenue('Q950000', facts, parents, MUSEUM_CLASSES);
    expect(r).toEqual({ venue: 'Q950003', hops: 1 });
  });
});
