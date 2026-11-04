/**
 * The one gather of works (#1821): each kind's share of a gather made for
 * several kinds is the pool its own questions collect, typed as they type it.
 */

import { describe, it, expect } from 'vitest';
import { gatherWorks, worksShare, WORK_NOUN, type WorksRequest } from './worksGather.js';
import {
  EDITION_ROOT, MUSEUM_BROAD_ROOTS, MUSEUM_PINNED_CLASSES, MUSEUM_PINNED_EDITION_CLASSES, MUSEUM_WHOLE_ROOTS,
} from './worksCollector.js';
import { ANCIENT_ART_ROOTS, ANCIENT_ART_WHOLE, FIND_CLASSES } from '../archaeology/classes.js';
import { makeSparql } from './pipelineFixture.js';

const MUSEUMS: WorksRequest = {
  broadRoots: MUSEUM_BROAD_ROOTS, wholeRoots: MUSEUM_WHOLE_ROOTS, pinned: MUSEUM_PINNED_CLASSES,
  pinnedEditionClasses: MUSEUM_PINNED_EDITION_CLASSES, editionRoot: EDITION_ROOT,
};
// Places of worship asks what the museums ask, and its relics beside them.
const WORSHIP: WorksRequest = { ...MUSEUMS, extraClasses: { Q187616: 'relic' } };
// Archaeology asks no painting: sculpture and statue, and its finds' classes.
const FINDS: WorksRequest = {
  broadRoots: ANCIENT_ART_ROOTS, wholeRoots: ANCIENT_ART_WHOLE, pinned: {},
  extraClasses: FIND_CLASSES, pinnedEditionClasses: new Set(), editionRoot: EDITION_ROOT,
};

const run = () => ({ sparql: makeSparql(), phase: () => {}, step: async () => {} });
const options = { logPrefix: '[test]', noun: WORK_NOUN };
const typed = (pool: ReturnType<typeof worksShare>['pool']) =>
  Object.fromEntries([...pool].map(([qid, work]) => [qid, `${work.type} ${work.typeQid}`]));

describe('gatherWorks', () => {
  it('gives each kind the share its own gather would have given it', async () => {
    const together = await gatherWorks(run(), [MUSEUMS, WORSHIP, FINDS], options);
    for (const request of [MUSEUMS, WORSHIP, FINDS]) {
      const alone = await gatherWorks(run(), [request], options);
      expect(typed(worksShare(together, request).pool)).toEqual(typed(worksShare(alone, request).pool));
    }
  });

  it('shows a museum no relic only Places of worship asked for', async () => {
    const together = await gatherWorks(run(), [MUSEUMS, WORSHIP], options);
    // The fixture's Shroud of Turin is held under the relic class alone.
    expect(together.pool.has('Q216141')).toBe(true);
    expect(worksShare(together, MUSEUMS).pool.has('Q216141')).toBe(false);
    expect(worksShare(together, WORSHIP).pool.get('Q216141')?.type).toBe('relic');
  });

  it('asks no class twice, and mixes no two kinds\' classes in one question', async () => {
    // A question's row limit is met by one kind's classes, as when each kind asked its own.
    const sparql = makeSparql();
    await gatherWorks({ sparql, phase: () => {}, step: async () => {} }, [MUSEUMS, WORSHIP, FINDS], options);
    const asked = sparql.mock.calls.map((call) => String(call[0]))
      .filter((query) => query.includes('VALUES ?cls'))
      .map((query) => [...(/VALUES \?cls \{([^}]*)\}/.exec(query)?.[1] ?? '').matchAll(/wd:(Q\d+)/g)].map((m) => m[1]));
    // The last such question is the lost tree's, which a closure may also reach (lost painting).
    const all = asked.slice(0, -1).flat();
    expect(new Set(all).size).toBe(all.length);
    const relic = asked.find((batch) => batch.includes('Q187616'));
    expect(relic?.every((qid) => qid in (WORSHIP.extraClasses ?? {}))).toBe(true);
  });

  it('refuses a kind it was not asked for, rather than handing it a share with holes', async () => {
    const museumsOnly = await gatherWorks(run(), [MUSEUMS], options);
    expect(() => worksShare(museumsOnly, WORSHIP)).toThrow(/did not ask/);
  });
});
