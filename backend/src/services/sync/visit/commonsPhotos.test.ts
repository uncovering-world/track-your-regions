import { describe, expect, it } from 'vitest';
import { WaitBudget } from '../sourceRetry.js';
import type { SparqlBinding } from '../wikidataUtils.js';
import { commonsPhotoDoor, metresBetween, photographed, photoQuestion } from './commonsPhotos.js';

/**
 * The photographs witness (#1768) against answers shaped as Commons' API gave
 * them on 2026-10-20: a category's files with each one's camera position, in
 * two pages joined by a continuation. The Roman Baths stand at 51.3809,
 * -2.3595.
 */

const BATHS = { qid: 'Q2540426', category: 'Roman Baths (Bath)', lat: 51.3809, lon: -2.3595 };

function fakeCommons(pages: Array<Array<{ title: string; coordinates?: { lat: number; lon: number }[] }>>) {
  const asked: URLSearchParams[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body));
    asked.push(body);
    const at = body.get('gcmcontinue') ? Number(body.get('gcmcontinue')) : 0;
    const answer = { query: { pages: pages[at] }, ...(at + 1 < pages.length ? { continue: { gcmcontinue: String(at + 1), continue: 'gcmcontinue||' } } : {}) };
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { asked, fetchImpl };
}

describe('the photographs witness', () => {
  it('counts the files of the category taken within a kilometre, over every page', async () => {
    const { asked, fetchImpl } = fakeCommons([
      [
        { title: 'File:Roman Baths 1.jpg', coordinates: [{ lat: 51.381, lon: -2.3596 }] },
        { title: 'File:Roman Baths plan.png' },
      ],
      [
        { title: 'File:Roman Baths 2.jpg', coordinates: [{ lat: 51.3805, lon: -2.359 }] },
        { title: 'File:Bath Abbey from afar.jpg', coordinates: [{ lat: 51.4, lon: -2.3595 }] },
      ],
    ]);
    const door = commonsPhotoDoor({ userAgent: 'test', fetchImpl, budget: new WaitBudget(1000) });
    expect(await door(photoQuestion(BATHS))).toEqual([{ near: { value: '2' }, files: { value: '4' } }]);
    expect(asked).toHaveLength(2);
    expect(asked[0].get('gcmtitle')).toBe('Category:Roman Baths (Bath)');
    expect(asked[0].get('prop')).toBe('coordinates');
  });

  it('stops reading a category once ten of its files were taken there', async () => {
    const onSite = Array.from({ length: 10 }, (_, i) => ({ title: `File:Roman Baths ${i}.jpg`, coordinates: [{ lat: 51.381, lon: -2.3596 }] }));
    const { asked, fetchImpl } = fakeCommons([onSite, [{ title: 'File:Never read.jpg' }]]);
    const door = commonsPhotoDoor({ userAgent: 'test', fetchImpl, budget: new WaitBudget(1000) });
    expect(await door(photoQuestion(BATHS))).toEqual([{ near: { value: '10' }, files: { value: '10' } }]);
    expect(asked).toHaveLength(1);
  });

  it('says which places the photographs witness: ten taken there, and nothing else', async () => {
    const questions: string[] = [];
    const answers: Record<string, SparqlBinding[]> = {
      'Roman Baths (Bath)': [{ near: { value: '98' } }],
      'Rungholt': [{ near: { value: '0' } }],
      'Pompeii': [{ near: { value: '9' } }],
    };
    const witness = await photographed(async (question) => {
      questions.push(question);
      return answers[JSON.parse(question).category] ?? [];
    }, [BATHS, { qid: 'Q639934', category: 'Rungholt', lat: 54.4667, lon: 8.7167 },
      { qid: 'Q43332', category: 'Pompeii', lat: 40.751, lon: 14.4869 }, { qid: 'Q1', category: 'Nowhere', lat: 0, lon: 0 }]);
    expect(witness).toEqual(new Map([['Q2540426', true], ['Q639934', false], ['Q43332', false], ['Q1', false]]));
    expect(JSON.parse(questions[0])).toEqual({ category: 'Roman Baths (Bath)', lat: 51.3809, lon: -2.3595 });
  });

  it('measures on the sphere', () => {
    expect(metresBetween({ lat: 51.3809, lon: -2.3595 }, { lat: 51.4, lon: -2.3595 })).toBeCloseTo(2124, -1);
  });
});
