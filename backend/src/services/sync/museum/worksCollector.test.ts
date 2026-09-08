/**
 * Tests for the stages every works-first kind shares: the class closure, the banded pool, the
 * venue statements, the venue graph, placement and folds. `pipeline.test.ts` exercises the same
 * fixture through the museum tail this module no longer holds.
 */

import { describe, it, expect } from 'vitest';
import { collectWorks, MUSEUM_BROAD_ROOTS, MUSEUM_WHOLE_ROOTS, MUSEUM_PINNED_CLASSES,
  MUSEUM_PINNED_EDITION_CLASSES, EDITION_ROOT } from './worksCollector.js';
import { museumRule } from './venueTest.js';
import { makeSparql, MUSEUM_CLASSES } from './pipelineFixture.js';

describe('collectWorks', () => {
  it('names what it is collecting in the phase lines the caller watches', async () => {
    const phases: string[] = [];
    const run = { sparql: makeSparql(), phase: (m: string) => phases.push(m), step: async () => {} };
    await collectWorks(run, {
      broadRoots: MUSEUM_BROAD_ROOTS, wholeRoots: MUSEUM_WHOLE_ROOTS, pinned: MUSEUM_PINNED_CLASSES,
      extraClasses: { Q187616: 'relic' },
      pinnedEditionClasses: MUSEUM_PINNED_EDITION_CLASSES, editionRoot: EDITION_ROOT,
      noun: { work: 'treasure', works: 'treasures' },
      rule: museumRule(MUSEUM_CLASSES), logPrefix: '[test]',
    });

    // Places of worship collects relics, tombs and reliquaries through this same
    // module, and "Finding the classes a work of art can be" is the wrong
    // sentence on the screen of a run collecting them (#753).
    expect(phases).toContain('Finding the classes a treasure can be...');
    expect(phases.some((p) => p.startsWith('Fetching narrow classes of treasures '))).toBe(true);
    expect(phases.some((p) => p.includes('artwork'))).toBe(false);
  });

  it('places the Mona Lisa at the Louvre through the department it names', async () => {
    const run = { sparql: makeSparql(), phase: () => {}, step: async () => {} };
    const out = await collectWorks(run, {
      broadRoots: MUSEUM_BROAD_ROOTS, wholeRoots: MUSEUM_WHOLE_ROOTS, pinned: MUSEUM_PINNED_CLASSES,
      pinnedEditionClasses: MUSEUM_PINNED_EDITION_CLASSES, editionRoot: EDITION_ROOT,
      noun: { work: 'work of art', works: 'artworks' },
      rule: museumRule(MUSEUM_CLASSES), logPrefix: '[test]',
    });
    expect(out.afterFolds.Q12418).toEqual(['Q19675']);
  });

  it('asks an extra class whole and types its works by its label', async () => {
    const run = { sparql: makeSparql(), phase: () => {}, step: async () => {} };
    const out = await collectWorks(run, {
      broadRoots: MUSEUM_BROAD_ROOTS, wholeRoots: MUSEUM_WHOLE_ROOTS, pinned: MUSEUM_PINNED_CLASSES,
      extraClasses: { Q187616: 'relic' },
      pinnedEditionClasses: MUSEUM_PINNED_EDITION_CLASSES, editionRoot: EDITION_ROOT,
      noun: { work: 'work of art', works: 'artworks' },
      rule: museumRule(MUSEUM_CLASSES), logPrefix: '[test]',
    });
    // The fixture answers a `VALUES ?cls` batch containing Q187616 with the Shroud row.
    expect(out.pool.get('Q216141')?.type).toBe('relic');
  });
});
