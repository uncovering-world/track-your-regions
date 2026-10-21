import { describe, expect, it, vi } from 'vitest';
import type { OsmObject } from '../osm/types.js';
import type { SparqlBinding } from '../wikidataUtils.js';
import { OSM_BATCH, type OsmDoor } from '../osm/readOsmObjects.js';
import type { SyncProgress } from '../types.js';
import {
  mapOfWhatAnswered, visitQuestionsOf, VISIT_QUESTION_SURE, type OfferedPlace, type VisitQuestionDoors,
} from './visitQuestions.js';

/**
 * Which offered places a run asks a curator about (#1770), on places the
 * survey of 2026-10-21 read: Eboracum (Roman York) and the Venus of Tan-Tan,
 * which nothing vouches for and Jev reads as not a place and an object; the
 * Roman Baths, which a guide and a heritage listing vouch for; Cloud Gate,
 * which a guide vouches for and its photographs decide; and Saqqara, which
 * the sources miss and Jev reads as a site.
 */

const place = (qid: string, name: string, extra: Partial<OfferedPlace> = {}): OfferedPlace => ({
  membershipId: Number(qid.slice(1)), experienceId: Number(qid.slice(1)), qid, name, lat: 41.88, lon: -87.62,
  asked: { name, countries: [], kinds: ['Archaeology'], map: null, article: null }, stored: null, ...extra,
});

const EBORACUM = place('Q958954', 'Eboracum');
const VENUS = place('Q856764', 'Venus of Tan-Tan');
const BATHS = place('Q2540426', 'Roman Baths');
const CLOUD_GATE = place('Q1093044', 'Cloud Gate');
const SAQQARA = place('Q35102', 'Saqqara');

const entity = (qid: string) => ({ value: `http://www.wikidata.org/entity/${qid}` });

function doors(readings: Record<string, { reading: 'visit' | 'nothing' | 'not-a-place' | 'object'; confidence: number }>) {
  const facts: SparqlBinding[] = [
    { e: entity('Q2540426'), formal: { value: 'Q1' } },
    { e: entity('Q1093044'), category: { value: 'Cloud Gate' } },
  ];
  return {
    sparql: vi.fn(async () => facts),
    guide: vi.fn(async () => new Set(['Q2540426', 'Q1093044'])),
    osm: vi.fn(async (qids: string[]) => new Map<string, OsmObject[]>(qids.map((qid) => [qid, []]))),
    photos: vi.fn(async (_question: string) => [{ near: { value: '0' }, files: { value: '6' } }]),
    read: vi.fn(async (asked: OfferedPlace) => readings[asked.qid] ?? null),
  } satisfies VisitQuestionDoors;
}

describe('the places a run asks a curator about (#1770)', () => {
  it('asks where few witnesses vouch and Jev reads nothing to visit, and nowhere else', async () => {
    const open = doors({
      Q958954: { reading: 'not-a-place', confidence: 0.9 },
      Q856764: { reading: 'object', confidence: 0.96 },
      Q1093044: { reading: 'visit', confidence: 0.98 },
      Q35102: { reading: 'visit', confidence: 0.95 },
    });

    const { short, questions } = await visitQuestionsOf([EBORACUM, VENUS, BATHS, CLOUD_GATE, SAQQARA], open);

    expect(short).toBe(4);
    expect(questions.map((q) => [q.place.name, q.reading.reading, q.witnesses])).toEqual([
      ['Eboracum', 'not-a-place', []],
      ['Venus of Tan-Tan', 'object', []],
    ]);
    // Two witnesses vouch for the Roman Baths: Jev is not asked.
    expect(open.read.mock.calls.map(([asked]) => asked.qid)).not.toContain('Q2540426');
  });

  it('reads the map only for the places still short, and the photographs only where they decide', async () => {
    const open = doors({});

    await visitQuestionsOf([EBORACUM, BATHS, CLOUD_GATE], open);

    expect(open.osm).toHaveBeenCalledWith(['Q958954', 'Q1093044']);
    // Cloud Gate has one witness and a category: its photographs decide. Eboracum has none to decide.
    expect(open.photos).toHaveBeenCalledTimes(1);
    expect(String(open.photos.mock.calls[0][0])).toContain('Cloud Gate');
  });

  it('leaves a place the map did not answer for unread: neither read by Jev nor asked', async () => {
    const open = doors({ Q958954: { reading: 'not-a-place', confidence: 0.9 }, Q856764: { reading: 'object', confidence: 0.96 } });
    // The mirror dropped the batch holding Eboracum: its map witness is not known.
    open.osm = vi.fn(async (qids: string[]) => new Map<string, OsmObject[]>(
      qids.filter((qid) => qid !== 'Q958954').map((qid) => [qid, []]),
    ));

    const { short, unread, questions } = await visitQuestionsOf([EBORACUM, VENUS], open);

    expect([short, unread]).toEqual([1, 1]);
    expect(questions.map((q) => q.place.name)).toEqual(['Venus of Tan-Tan']);
    expect(open.read.mock.calls.map(([asked]) => asked.qid)).toEqual(['Q856764']);
  });

  it('reads every lead at once and gives each its own; a place whose lead was not read is not read', async () => {
    const open = doors({ Q958954: { reading: 'not-a-place', confidence: 0.9 }, Q856764: { reading: 'object', confidence: 0.96 } });
    const venus = { ...VENUS, asked: { ...VENUS.asked, article: 'https://en.wikipedia.org/wiki/Venus_of_Tan-Tan' } };
    const eboracum = { ...EBORACUM, asked: { ...EBORACUM.asked, article: 'https://en.wikipedia.org/wiki/Eboracum' } };
    // Wikipedia answered for the Venus and not for Eboracum.
    const leads = vi.fn(async () => new Map([[venus.asked.article, 'A stone found in Morocco.']]));

    const { unread, questions } = await visitQuestionsOf([eboracum, venus], { ...open, leads });

    expect(leads).toHaveBeenCalledTimes(1);
    expect(unread).toBe(1);
    expect(questions.map((q) => q.place.name)).toEqual(['Venus of Tan-Tan']);
    expect(open.read.mock.calls).toEqual([[venus, 'A stone found in Morocco.']]);
  });

  it('asks nothing where Jev is not sure enough', async () => {
    const open = doors({ Q958954: { reading: 'nothing', confidence: VISIT_QUESTION_SURE - 0.01 } });

    expect((await visitQuestionsOf([EBORACUM], open)).questions).toEqual([]);
  });

  it('reuses the reading a place already has, and pays for none', async () => {
    const open = doors({});
    const stored = { ...EBORACUM, stored: { reading: 'not-a-place' as const, confidence: 0.9 } };

    const { questions } = await visitQuestionsOf([stored], open);

    expect(questions).toHaveLength(1);
    expect(open.read).not.toHaveBeenCalled();
  });
});

describe('the map, a batch at a time (#1770)', () => {
  it('leaves out the places of a batch the mirror did not answer, and keeps the rest', async () => {
    const qids = Array.from({ length: OSM_BATCH + 1 }, (_, i) => `Q${i + 1}`);
    const door: OsmDoor = {
      name: 'qlever',
      question: (batch) => batch.join(' '),
      digsQuestions: () => [],
      // The second batch, the last item alone, times out on the mirror.
      send: vi.fn(async (query: string) => {
        if (query === qids[OSM_BATCH]) throw new Error('This operation was aborted');
        return [];
      }),
    };

    const read = await mapOfWhatAnswered(door, qids, { cancel: false, statusMessage: '' } as SyncProgress);

    expect(read.size).toBe(OSM_BATCH);
    expect(read.has(qids[OSM_BATCH])).toBe(false);
    expect(read.get('Q1')).toEqual([]);
  });

  it('leaves the rest of the map for the next run once the mirror drops two batches in a row', async () => {
    const qids = Array.from({ length: OSM_BATCH * 4 }, (_, i) => `Q${i + 1}`);
    const send = vi.fn(async (query: string) => {
      if (query !== qids.slice(0, OSM_BATCH).join(' ')) throw new Error('This operation was aborted');
      return [];
    });
    const door: OsmDoor = { name: 'qlever', question: (batch) => batch.join(' '), digsQuestions: () => [], send };

    const read = await mapOfWhatAnswered(door, qids, { cancel: false, statusMessage: '' } as SyncProgress);

    expect(read.size).toBe(OSM_BATCH);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('ends the read on a Cancel rather than counting it as a dropped batch', async () => {
    const progress = { cancel: false, statusMessage: '' } as SyncProgress;
    const door: OsmDoor = {
      name: 'qlever', question: (batch) => batch.join(' '), digsQuestions: () => [],
      send: vi.fn(async () => { progress.cancel = true; throw new Error('Sync cancelled'); }),
    };

    await expect(mapOfWhatAnswered(door, ['Q1'], progress)).rejects.toThrow('Sync cancelled');
  });
});
