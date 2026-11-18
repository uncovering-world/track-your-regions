/**
 * Tests for a World Heritage Site's inscription as the UNESCO run's record
 * names it and as the typed tables give it back (#2127).
 */

import { describe, it, expect } from 'vitest';
import { inscriptionFacts, inscriptionOf, splitInscriptionFacts } from './inscription.js';

describe('inscriptionOf', () => {
  it('reads the Struve Geodetic Arc, a serial site across ten countries', () => {
    expect(inscriptionOf({
      dateInscribed: '2005', inDanger: false, dangerList: null, criteria: '(ii)(iii)(vi)',
      region: 'Europe and North America', areaHectares: 0, transboundary: true,
    })).toEqual({
      inscribedYear: 2005, inDanger: false, dangerSince: null, criteria: ['(ii)', '(iii)', '(vi)'],
      region: 'Europe and North America', areaHa: null, transboundary: true,
    });
  });

  it('reads Bamiyan in danger since 2003 from its listing alone', () => {
    expect(inscriptionOf({ dangerList: 'Y 2003' })).toEqual(expect.objectContaining({ inDanger: true, dangerSince: 2003 }));
  });

  it('takes the flag over the listing wherever the flag is given', () => {
    // A curator publishing Bamiyan's `inDanger: false` alone, onto the
    // listing the tables give back while its stay is open.
    expect(inscriptionOf({ inDanger: false, dangerList: 'Y 2003' })).toEqual(expect.objectContaining({ inDanger: false, dangerSince: null }));
    expect(inscriptionOf({ inDanger: true, dangerList: null })).toEqual(expect.objectContaining({ inDanger: true, dangerSince: null }));
  });

  it('dates no stay on a site out of danger, and refuses a region outside UNESCO\'s five', () => {
    expect(inscriptionOf({ inDanger: false, dangerList: 'N', region: 'Europe' }))
      .toEqual(expect.objectContaining({ inDanger: false, dangerSince: null, region: null }));
  });

  it('reads the longer numerals first, so (iii) is not (i)', () => {
    expect(inscriptionOf({ criteria: '(viii)(iii)(x)' }).criteria).toEqual(['(viii)', '(iii)', '(x)']);
  });

  it('keeps an area to the hundredth', () => {
    expect(inscriptionOf({ areaHectares: 158.9265 }).areaHa).toBe(158.93);
  });

  it('reads no area where the hundredth the column holds would not keep it', () => {
    expect(inscriptionOf({ areaHectares: 0.004 }).areaHa).toBeNull();
    expect(inscriptionOf({ areaHectares: 999999999999.999 }).areaHa).toBeNull();
  });
});

describe('inscriptionFacts', () => {
  it('writes the record\'s keys back in the one form the tables give', () => {
    // Cologne Cathedral, out of danger since 2006.
    expect(inscriptionFacts(inscriptionOf({
      dateInscribed: '1996', inDanger: false, dangerList: 'N', criteria: '(i)(ii)(iv)',
      region: 'Europe and North America', areaHectares: '1.2', transboundary: false,
    }))).toEqual({
      dateInscribed: '1996', inDanger: false, dangerList: null, criteria: '(i)(ii)(iv)',
      region: 'Europe and North America', areaHectares: 1.2, transboundary: false,
    });
  });

  it('reads back what it wrote', () => {
    const facts = { dateInscribed: '2003', inDanger: true, dangerList: 'Y 2003', criteria: '(i)(ii)', region: null, areaHectares: null, transboundary: false };
    expect(inscriptionFacts(inscriptionOf(facts))).toEqual(facts);
  });

  it('says a site is in danger with no year as "Y"', () => {
    expect(inscriptionFacts(inscriptionOf({ inDanger: true })).dangerList).toBe('Y');
  });
});

describe('splitInscriptionFacts', () => {
  it('leaves the facts of no inscription in the facts', () => {
    expect(splitInscriptionFacts({ tier: 'world', inDanger: true })).toEqual({ inscription: { inDanger: true }, rest: { tier: 'world' } });
    expect(splitInscriptionFacts({ tier: 'world' })).toEqual({ inscription: null, rest: { tier: 'world' } });
  });
});
