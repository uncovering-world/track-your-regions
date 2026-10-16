import { describe, expect, it } from 'vitest';
import { chooseByPoint } from './countryByPoint.js';

describe('chooseByPoint (#1564)', () => {
  const names = new Map([
    ['Q148', ["People's Republic of China", 'China', 'Chine']],
    ['Q96', ['Mexico', 'Mexiko']],
  ]);

  it('names the standing country whose territory holds the point', () => {
    // Sant'Ambrogio: Russia (Q159) first, Italy (Q38) second; the point is in Italy.
    const options = { candidates: [{ qid: 'Q159', label: 'Russia' }, { qid: 'Q38', label: 'Italy' }], noneStands: false };
    expect(chooseByPoint(options, 'Italy', new Map())).toBe('Italy');
  });

  it('matches by any label of the item, folded and without diacritics', () => {
    const china = { candidates: [{ qid: 'Q865', label: 'Taiwan' }, { qid: 'Q148', label: "People's Republic of China" }], noneStands: false };
    expect(chooseByPoint(china, 'China', names)).toBe("People's Republic of China");
    const mexico = { candidates: [{ qid: 'Q30', label: 'United States' }, { qid: 'Q96', label: 'Mexico' }], noneStands: false };
    expect(chooseByPoint(mexico, 'México', names)).toBe('Mexico');
  });

  it('keeps the readers\' choice when the point is in none of the candidates', () => {
    const options = { candidates: [{ qid: 'Q159', label: 'Russia' }, { qid: 'Q212', label: 'Ukraine' }], noneStands: false };
    expect(chooseByPoint(options, 'Moldova', new Map())).toBeNull();
  });

  it('writes a GADM answer as the sovereign state it names', () => {
    // Chang'an, stated only in dynasties that are gone; the People's Republic of China
    // (Q148) is a sovereign state whose German label is GADM's "China".
    const changan = { candidates: [{ qid: 'Q7209', label: 'Han dynasty' }], noneStands: true };
    const states = [{ qid: 'Q38', label: 'Italy' }, { qid: 'Q148', label: "People's Republic of China" }];
    expect(chooseByPoint(changan, 'China', names, states)).toBe("People's Republic of China");
  });

  it('names the GADM country itself when no candidate stands', () => {
    // Mediolanum: Ancient Rome alone; the point is in Milan.
    expect(chooseByPoint({ candidates: [{ qid: 'Q1747689', label: 'Ancient Rome' }], noneStands: true }, 'Italy', new Map()))
      .toBe('Italy');
  });
});
