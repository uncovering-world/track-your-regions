/**
 * Tests for the stages every works-first kind shares: the class closure, the banded pool, the
 * venue statements, the venue graph, placement and folds. `pipeline.test.ts` exercises the same
 * fixture through the museum tail, which is not this module's.
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

  it('keeps only the works a kind wants, and asks no statements about the rest', async () => {
    // Archaeology collects the art pool and keeps the finds in it: a sculpture of
    // 1510 with no discovery place is nobody's find, and reading its venues would
    // be a question asked about a work already dropped.
    const sparql = makeSparql();
    const run = { sparql, phase: () => {}, step: async () => {} };
    const asked: string[][] = [];
    const out = await collectWorks(run, {
      broadRoots: MUSEUM_BROAD_ROOTS, wholeRoots: MUSEUM_WHOLE_ROOTS, pinned: MUSEUM_PINNED_CLASSES,
      pinnedEditionClasses: MUSEUM_PINNED_EDITION_CLASSES, editionRoot: EDITION_ROOT,
      noun: { work: 'find', works: 'finds' },
      rule: museumRule(MUSEUM_CLASSES), logPrefix: '[test]',
      workFacts: async (_run, qids) => {
        asked.push(qids);
        return new Map([['Q12418', { classes: ['Q_NOT_OURS'], discoveryPlace: null }]]);
      },
      keep: (_work, facts) => !facts?.classes.includes('Q_NOT_OURS'),
    });

    // The facts are asked once, of the whole pool, before anything is dropped.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('Q12418');
    expect(asked[0]).toContain('Q207947');

    expect(out.pool.has('Q12418')).toBe(false);
    expect(out.placed.Q12418).toBeUndefined();
    expect(out.afterFolds.Q12418).toBeUndefined();
    // A work no rule dropped is collected as it always was.
    expect(out.pool.has('Q207947')).toBe(true);

    // A dropped work costs no statement query: the venue statements are asked of
    // what survived the keep, not of the pool that was collected.
    const statementQueries = sparql.mock.calls
      .map((c) => String(c[0])).filter((q) => q.includes('p:P195'));
    expect(statementQueries.length).toBeGreaterThan(0);
    expect(statementQueries.some((q) => q.includes('Q12418'))).toBe(false);
    expect(statementQueries.some((q) => q.includes('Q207947'))).toBe(true);
  });

  it('places a work nobody can see nowhere, and says why (#868)', async () => {
    const run = { sparql: makeSparql(), phase: () => {}, step: async () => {} };
    const out = await collectWorks(run, {
      broadRoots: MUSEUM_BROAD_ROOTS, wholeRoots: MUSEUM_WHOLE_ROOTS, pinned: MUSEUM_PINNED_CLASSES,
      pinnedEditionClasses: MUSEUM_PINNED_EDITION_CLASSES, editionRoot: EDITION_ROOT,
      noun: { work: 'work of art', works: 'artworks' },
      rule: museumRule(MUSEUM_CLASSES), logPrefix: '[test]',
    });

    // The Storm is a lost painting whose collection is unknown at preferred rank: both
    // readings say the same thing, and the reason a person gets is the first one asked.
    expect(out.unseen.Q2246489).toEqual({ reason: 'whereabouts unknown', wouldBe: ['Q49135'] });
    expect(out.unseen.Q1169395).toEqual({ reason: 'whereabouts unknown', wouldBe: ['Q49135'] });
    // A lost artwork the closure never reaches, arrived typed `painting`.
    expect(out.pool.get('Q2395137')?.type).toBe('painting');
    expect(out.unseen.Q2395137).toEqual({ reason: 'lost artwork', wouldBe: ['Q900011'] });
    for (const qid of ['Q2246489', 'Q1169395', 'Q2395137']) expect(out.afterFolds[qid]).toEqual([]);

    // The colossus is a destroyed artwork whose fragments are on show, kept by name.
    expect(out.unseen.Q1289781).toBeUndefined();
    expect(out.afterFolds.Q1289781).toEqual(['Q333906']);
    // An anonymous owner is not an unknown whereabouts.
    expect(out.unseen.Q152849).toBeUndefined();
    expect(out.afterFolds.Q152849).toEqual(['Q333906']);
  });
});
