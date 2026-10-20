import { describe, expect, it } from 'vitest';
import { FoldTitles, titleHash } from './foldTitles.js';

describe('the titles a month stages under the floor (#1702)', () => {
  it('answers yes for every title in the set, in its own edition only', () => {
    const titles = Array.from({ length: 5000 }, (_, i) => ({ site: i % 2 ? 'enwiki' : 'dewiki', title: `Title ${i}` }));
    const set = FoldTitles.of(titles);
    expect(titles.every(t => set.has(t.site, t.title))).toBe(true);
    expect(set.has('frwiki', 'Title 1')).toBe(false);
    expect(titleHash('frwiki', 'Title 1')).not.toBe(titleHash('enwiki', 'Title 1'));
  });

  it('holds a title met twice once, and nothing when it is empty', () => {
    const set = FoldTitles.of([{ site: 'enwiki', title: 'Kölner Dom' }, { site: 'enwiki', title: 'Kölner Dom' }]);
    expect(set.size).toBe(1);
    expect(set.has('enwiki', 'Kölner Dom')).toBe(true);
    expect(FoldTitles.of([]).has('enwiki', 'Kölner Dom')).toBe(false);
  });
});
