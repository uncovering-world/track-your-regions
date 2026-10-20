import { describe, expect, it } from 'vitest';
import { FoldTitles } from './foldTitles.js';
import { MonthSummer, type StagedRow } from './monthSummer.js';

async function sum(lines: string[], floor = 10, dailyFloor = 400, batch = 2, folded = FoldTitles.of([])): Promise<{ rows: StagedRow[]; batches: number; summer: MonthSummer }> {
  const rows: StagedRow[] = [];
  let batches = 0;
  const summer = new MonthSummer({
    days: 30, floor, dailyFloor, batch, folded,
    onBatch: async taken => { batches++; rows.push(...taken); },
  });
  for (const line of lines) await summer.line(line);
  await summer.finish();
  return { rows, batches, summer };
}

describe("a month's file summed per article (#1436)", () => {
  it('adds a title’s adjacent access methods into one row, its phone views apart', async () => {
    const { rows } = await sum([
      'en.wikipedia Cologne_Cathedral 6127 desktop 300 A100B200',
      'en.wikipedia Cologne_Cathedral 6127 mobile-web 250 A50C200',
      'en.wikipedia Cologne_Cathedral 6127 mobile-app 10 C10',
    ]);
    expect(rows).toEqual([{
      site: 'enwiki', title: 'Cologne Cathedral', views: 560, mobile: 260,
      daily: [150, 200, 210, ...new Array(27).fill(0)],
    }]);
  });

  it('stages no title under the floor, keeps no daily series under its floor, and counts every edition’s views', async () => {
    const { rows, summer } = await sum([
      'de.wikipedia Kölner_Dom 1 desktop 9 A9',
      'de.wikipedia Köln 2 desktop 40 A40',
      'en.wiktionary dome null desktop 500 A500',
    ]);
    expect(rows).toEqual([{ site: 'dewiki', title: 'Köln', views: 40, mobile: 0, daily: null }]);
    expect(Object.fromEntries(summer.editionViews)).toEqual({ dewiki: 49 });
    expect(summer.lines).toBe(3);
  });

  it('stages an encoded spelling whatever its count, under the decoded title, for the month’s SQL to sum', async () => {
    const { rows, summer } = await sum([
      'ru.wikipedia %D0%9A%D1%91%D0%BB%D1%8C%D0%BD null desktop 3 A3',
      'ru.wikipedia Кёльн 77 desktop 500 A500',
    ]);
    expect(rows.map(r => [r.title, r.views])).toEqual([['Кёльн', 3], ['Кёльн', 500]]);
    expect(summer.encoded).toBe(1);
  });

  it('stages a folded redirect and the article it folds into under the floor, for the month’s SQL to sum (#1702)', async () => {
    const folded = FoldTitles.of([
      { site: 'enwiki', title: 'A Virgin with a Unicorn' }, { site: 'enwiki', title: 'Maiden with the Unicorn' },
    ]);
    const { rows } = await sum([
      'en.wikipedia A_Virgin_with_a_Unicorn 1 desktop 6 A6',
      'en.wikipedia Maiden_with_the_Unicorn 2 desktop 4 A4',
      'en.wikipedia Unicorn_(disambiguation) 3 desktop 9 A9',
    ], 10, 400, 10, folded);
    expect(rows.map(r => [r.title, r.views])).toEqual([['A Virgin with a Unicorn', 6], ['Maiden with the Unicorn', 4]]);
  });

  it('hands rows on in batches and the rest at the end', async () => {
    const { rows, batches } = await sum([
      'en.wikipedia A null desktop 10 A10',
      'en.wikipedia B null desktop 10 A10',
      'en.wikipedia C null desktop 10 A10',
    ]);
    expect(rows.map(r => r.title)).toEqual(['A', 'B', 'C']);
    expect(batches).toBe(2);
  });
});
