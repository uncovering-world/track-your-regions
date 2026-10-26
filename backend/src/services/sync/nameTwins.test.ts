import { describe, expect, it, vi } from 'vitest';
import { catalogueName, namedApart, twinHint } from './nameTwins.js';

describe('the hint a description gives a twin (#1967)', () => {
  it('reads the place after "in", up to a comma', () => {
    expect(twinHint("memorial in Berlin's Treptower Park")).toBe("Berlin's Treptower Park");
    expect(twinHint('mosque in Tabriz, Iran')).toBe('Tabriz');
  });

  it('tidies the hint as a stored name is tidied', () => {
    expect(twinHint('memorial in  Berlin\u2019s   Treptower Park ')).toBe('Berlin\u2019s Treptower Park');
  });

  it('reads past the period of an abbreviation', () => {
    expect(twinHint('cathedral in St. Petersburg, Russia')).toBe('St. Petersburg');
  });

  it('gives none where the description names no place', () => {
    expect(twinHint('war memorial')).toBeNull();
    expect(twinHint(null)).toBeNull();
  });

  it('names the label apart, unless the label already says the hint', () => {
    expect(namedApart('Hagia Sophia', 'mosque in Istanbul, Turkey')).toBe('Hagia Sophia (Istanbul)');
    expect(namedApart('Prehistoric Sites and Decorated Caves of the Vézère Valley',
      'archaeological sites in the Vézère Valley, France')).toBe('Prehistoric Sites and Decorated Caves of the Vézère Valley');
  });
});

describe('the name a record is written under (#1967)', () => {
  const answer = (twin: boolean, others: { sourceId: number; description: string | null }[] = []) =>
    ({ query: vi.fn().mockResolvedValue({ rows: [{ twin, others }] }) });
  const record = (sourceId: number, description: string | null) =>
    ({ sourceId, label: 'Soviet War Memorial', description });

  it('names the label apart where the catalogue holds a twin, and keeps it where it holds none', async () => {
    const subtitle = "memorial in Berlin's Treptower Park";
    const twin = answer(true);
    expect(await catalogueName(twin, record(6, subtitle), 1480)).toBe("Soviet War Memorial (Berlin's Treptower Park)");
    expect(await catalogueName(answer(false), record(6, subtitle), 1480)).toBe('Soviet War Memorial');
    expect(twin.query).toHaveBeenCalledWith(expect.any(String), ['Soviet War Memorial', 1480, 6]);
  });

  it('takes the hint of the place, so a source that gives none or another names it alike', async () => {
    const others = [{ sourceId: 6, description: "memorial in Berlin's Treptower Park" }];
    const named = "Soviet War Memorial (Berlin's Treptower Park)";
    expect(await catalogueName(answer(true, others), record(4, 'memorial church'), 1480)).toBe(named);
    expect(await catalogueName(answer(true, others), record(9, 'memorial in Berlin'), 1480)).toBe(named);
  });

  it('keeps the label where no source of the place gives a hint', async () => {
    expect(await catalogueName(answer(true, [{ sourceId: 1, description: null }]), record(6, 'war memorial'), 1480))
      .toBe('Soviet War Memorial');
  });
});
