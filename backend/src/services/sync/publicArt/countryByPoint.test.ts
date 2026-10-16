import { describe, expect, it } from 'vitest';
import { chooseByPoint } from './countryByPoint.js';

describe('chooseByPoint (#1564)', () => {
  const names = new Map([
    ['Q148', ["People's Republic of China", 'China', 'Chine']],
    ['Q96', ['Mexico', 'Mexiko']],
  ]);

  it('names the standing country whose territory holds the point', () => {
    // Sant'Ambrogio: Russia (Q159) first, Italy (Q38) second; the point is in Italy.
    const options = { candidates: [{ qid: 'Q159', label: 'Russia', sovereign: true }, { qid: 'Q38', label: 'Italy', sovereign: true }], noneStands: false };
    expect(chooseByPoint(options, 'Italy', new Map())).toBe('Italy');
  });

  it('matches by any label of the item, folded and without diacritics', () => {
    const china = { candidates: [{ qid: 'Q865', label: 'Taiwan', sovereign: true }, { qid: 'Q148', label: "People's Republic of China", sovereign: true }], noneStands: false };
    expect(chooseByPoint(china, 'China', names)).toBe("People's Republic of China");
    const mexico = { candidates: [{ qid: 'Q30', label: 'United States', sovereign: true }, { qid: 'Q96', label: 'Mexico', sovereign: true }], noneStands: false };
    expect(chooseByPoint(mexico, 'México', names)).toBe('Mexico');
  });

  it('keeps the readers\' choice when the point is in none of the candidates', () => {
    const options = { candidates: [{ qid: 'Q159', label: 'Russia', sovereign: true }, { qid: 'Q212', label: 'Ukraine', sovereign: true }], noneStands: false };
    expect(chooseByPoint(options, 'Moldova', new Map())).toBeNull();
  });

  it('writes a GADM answer as the sovereign state it names', () => {
    // Chang'an, stated only in dynasties that are gone; the People's Republic of China
    // (Q148) is a sovereign state whose German label is GADM's "China".
    const changan = { candidates: [{ qid: 'Q7209', label: 'Han dynasty', sovereign: false }], noneStands: true };
    const states = [{ qid: 'Q38', label: 'Italy', sovereign: true }, { qid: 'Q148', label: "People's Republic of China", sovereign: true }];
    expect(chooseByPoint(changan, 'China', names, states)).toBe("People's Republic of China");
  });

  it('names the GADM country when no standing candidate is a state of today (#1575)', () => {
    // Shechem (Tell Balata, Nablus): stated only in the United Kingdom of Israel, an ancient
    // state with no dissolution the reader sees; the point is in GADM's Palestine.
    const shechem = { candidates: [{ qid: 'Q3185305', label: 'United Kingdom of Israel', sovereign: false }], noneStands: false };
    expect(chooseByPoint(shechem, 'Palestine', new Map())).toBe('Palestine');
    // Nagaoka-kyō: stated in an item the reader holds nothing of, labelled by its id.
    const nagaoka = { candidates: [{ qid: 'Q132869361', label: 'Q132869361', sovereign: false }], noneStands: false };
    const states = [{ qid: 'Q17', label: 'Japan', sovereign: true }];
    expect(chooseByPoint(nagaoka, 'Japan', new Map(), states)).toBe('Japan');
  });

  it('keeps a country that is no sovereign state when the point is in it (#1575)', () => {
    // A Danish church stated in Denmark (Q35), a constituent country GADM names alike.
    const church = { candidates: [{ qid: 'Q35', label: 'Denmark', sovereign: false }], noneStands: false };
    expect(chooseByPoint(church, 'Denmark', new Map())).toBe('Denmark');
  });

  it('names the GADM country itself when no candidate stands', () => {
    // Mediolanum: Ancient Rome alone; the point is in Milan.
    expect(chooseByPoint({ candidates: [{ qid: 'Q1747689', label: 'Ancient Rome', sovereign: false }], noneStands: true }, 'Italy', new Map()))
      .toBe('Italy');
  });
});
