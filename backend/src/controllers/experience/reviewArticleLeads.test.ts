import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('../../services/sync/visit/visitReading.js', () => ({ articleLeads: vi.fn() }));

import { pool } from '../../db/index.js';
import { articleLeads } from '../../services/sync/visit/visitReading.js';
import { answer, routeAt } from '../../api/routeTesting.js';
import { experienceEvidenceRoutes } from '../../routes/experienceEvidenceRoutes.js';
import { firstSentence, forgetArticleLeads } from './reviewArticleLeads.js';

const query = vi.mocked(pool.query);
const leads = vi.mocked(articleLeads);
const CURATOR = { id: 7, role: 'curator' } as Express.User;
const route = routeAt(experienceEvidenceRoutes, '/review/article-leads');

/** The answer on the declared route, the ids as the wire sends them: its status and its body. */
async function read(ids: string, user: Express.User = CURATOR) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await answer(route, { query: { ids }, user }, res);
  return { status: res.status.mock.calls.at(-1)?.[0] ?? 200, body: res.json.mock.calls.at(-1)?.[0] };
}

const DORMITION = 'https://en.wikipedia.org/wiki/Dormition_Cathedral,_Kharkiv';
const PERIPHERIQUE = 'https://en.wikipedia.org/wiki/Boulevard_P%C3%A9riph%C3%A9rique';

function rows(...pairs: [number, string][]) {
  query.mockResolvedValueOnce({ rows: pairs.map(([placeId, url]) => ({ placeId, url })) } as never);
}

beforeEach(() => {
  query.mockReset();
  leads.mockReset();
  forgetArticleLeads();
});

describe('the first sentence of a lead (#2185)', () => {
  it('takes the first sentence, keeping an abbreviation inside it', () => {
    expect(firstSentence('The Dormition Cathedral is an Orthodox cathedral in Kharkiv. Its bell tower is 90 m high.'))
      .toBe('The Dormition Cathedral is an Orthodox cathedral in Kharkiv.');
    expect(firstSentence('St. Peter\'s Basilica is a church in Vatican City. It is large.'))
      .toBe('St. Peter\'s Basilica is a church in Vatican City.');
  });

  it('drops a bracket the extract emptied of its pronunciation, and keeps one that says something', () => {
    expect(firstSentence('Buckingham Palace (UK: ) is the official residence of the monarch in London. It is large.'))
      .toBe('Buckingham Palace is the official residence of the monarch in London.');
    expect(firstSentence('Leicester Square (UK: , US: ) is a pedestrianised square in London.'))
      .toBe('Leicester Square is a pedestrianised square in London.');
    expect(firstSentence('The Kelpies ( ) are 30-metre horse-head sculptures.'))
      .toBe('The Kelpies are 30-metre horse-head sculptures.');
    expect(firstSentence('The Brooklyn Bridge (1883) is a bridge. It is long.')).toBe('The Brooklyn Bridge (1883) is a bridge.');
    expect(firstSentence('Hagia Sophia (1453–1934) was a mosque.')).toBe('Hagia Sophia (1453–1934) was a mosque.');
    expect(firstSentence('Kyaiktiyo Pagoda (Burmese: ကျိုက်ထီးရိုးဘုရား pronounced [tɕaɪʔtʰíjó pʰəjá]; also known as Golden Rock) '
      + 'is a well-known Buddhist pilgrimage site in Mon State, Myanmar. It sits on a boulder.'))
      .toBe('Kyaiktiyo Pagoda is a well-known Buddhist pilgrimage site in Mon State, Myanmar.');
    expect(firstSentence('Lötschberg Base Tunnel (German: Lötschberg-Basistunnel) is a railway tunnel.'))
      .toBe('Lötschberg Base Tunnel (German: Lötschberg-Basistunnel) is a railway tunnel.');
  });

  it('answers null for no lead', () => {
    expect(firstSentence(null)).toBeNull();
    expect(firstSentence('   ')).toBeNull();
  });
});

describe('the article leads of a page of review cards (#2185)', () => {
  it('names each asked place\'s article by its title, with the first sentence of its lead', async () => {
    rows([15409, DORMITION], [44213, PERIPHERIQUE]);
    leads.mockResolvedValueOnce(new Map([
      [DORMITION, 'The Dormition Cathedral is an Orthodox cathedral in Kharkiv. It has a bell tower.'],
      [PERIPHERIQUE, 'The Boulevard Périphérique is a controlled-access ring road in Paris.'],
    ]));

    const { status, body } = await read('15409,44213');

    expect(status).toBe(200);
    expect(body.leads).toEqual([
      { placeId: 15409, title: 'Dormition Cathedral, Kharkiv', url: DORMITION,
        sentence: 'The Dormition Cathedral is an Orthodox cathedral in Kharkiv.' },
      { placeId: 44213, title: 'Boulevard Périphérique', url: PERIPHERIQUE,
        sentence: 'The Boulevard Périphérique is a controlled-access ring road in Paris.' },
    ]);
    // Only the caller's scoped questions are read, and the ids are bound, never spelled.
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('FROM scoped k');
    expect(params).toEqual(expect.arrayContaining([7, [15409, 44213]]));
  });

  it('asks Wikipedia once for a lead read within the day', async () => {
    rows([15409, DORMITION]);
    leads.mockResolvedValueOnce(new Map([[DORMITION, 'The Dormition Cathedral is a cathedral.']]));
    await read('15409');
    rows([15409, DORMITION]);
    const again = await read('15409');

    expect(leads).toHaveBeenCalledTimes(1);
    expect(again.body.leads).toHaveLength(1);
  });

  it('leaves out a place whose article Wikipedia did not answer for, or that has no English article', async () => {
    rows([15409, DORMITION], [9, 'https://de.wikipedia.org/wiki/Mariä-Entschlafens-Kathedrale']);
    leads.mockResolvedValueOnce(new Map());
    expect((await read('15409,9')).body.leads).toEqual([]);
    expect(leads).toHaveBeenCalledWith([DORMITION], expect.anything(), expect.anything());
  });

  it('answers no leads, never an error, when Wikipedia does not answer at all', async () => {
    rows([15409, DORMITION]);
    leads.mockRejectedValueOnce(new Error('Wikipedia answered 503'));
    expect((await read('15409')).body.leads).toEqual([]);
  });

  it('asks Wikipedia once for an article two cards ask about at the same time', async () => {
    let answerWikipedia: (read: Map<string | null, string | null>) => void = () => {};
    leads.mockReturnValueOnce(new Promise(resolve => { answerWikipedia = resolve; }));
    rows([15409, DORMITION]);
    rows([15409, DORMITION]);
    const first = read('15409');
    const second = read('15409');
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    answerWikipedia(new Map([[DORMITION, 'The Dormition Cathedral is a cathedral.']]));

    expect((await first).body.leads).toHaveLength(1);
    expect((await second).body.leads).toHaveLength(1);
    expect(leads).toHaveBeenCalledTimes(1);
  });

  it('answers no lead after five seconds without Wikipedia, and keeps a late answer for the next card', async () => {
    vi.useFakeTimers();
    try {
      let answerWikipedia: (read: Map<string | null, string | null>) => void = () => {};
      leads.mockReturnValueOnce(new Promise(resolve => { answerWikipedia = resolve; }));
      rows([15409, DORMITION]);
      const waiting = read('15409');
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await waiting).body.leads).toEqual([]);

      // A card opened again before Wikipedia answers waits on the same read rather than asking again.
      rows([15409, DORMITION]);
      const again = read('15409');
      answerWikipedia(new Map([[DORMITION, 'The Dormition Cathedral is a cathedral.']]));
      await vi.advanceTimersByTimeAsync(0);
      expect((await again).body.leads).toHaveLength(1);
      expect(leads).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers no lead for a sentence older than a day whose refresh Wikipedia did not answer', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-16T10:00:00Z'));
      rows([15409, DORMITION]);
      leads.mockResolvedValueOnce(new Map([[DORMITION, 'The Dormition Cathedral is a cathedral.']]));
      expect((await read('15409')).body.leads).toHaveLength(1);

      vi.setSystemTime(new Date('2026-11-17T11:00:00Z'));
      rows([15409, DORMITION]);
      leads.mockResolvedValueOnce(new Map());
      expect((await read('15409')).body.leads).toEqual([]);
      expect(leads).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is declared for curators only', () => {
    // The router's access check refuses a traveller before the handler runs.
    expect(route.access).toBe('curator');
  });

  it('refuses ids that are not a list of row ids, and asks nothing', async () => {
    await expect(read('0,abc')).rejects.toThrow();
    await expect(read('0')).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
