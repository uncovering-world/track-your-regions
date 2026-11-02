import { beforeEach, describe, expect, it, vi } from 'vitest';

const readership = vi.hoisted(() => ({
  readershipYear: vi.fn(),
  readWorks: vi.fn(),
  readAtLeast: vi.fn(),
  burstsAmong: vi.fn(),
}));
vi.mock('../dumps/readership/workReadership.js', () => readership);

import { readUnderFloor } from './readershipDoor.js';

/**
 * The read under the floor (ADR-0165), on a door's tier drawn small: three
 * items at the line of 22 read 100, 200 and 300 thousand times a year, so the
 * bar (the median) is 200,000; an item below the line does not move it.
 */
const year = { months: ['2025-10-01'], editions: ['enwiki'] };
const held = [
  { qid: 'Q22647', sitelinks: 121 },
  { qid: 'Q43332', sitelinks: 122 },
  { qid: 'Q184427', sitelinks: 83 },
  { qid: 'Q56072866', sitelinks: 12 },
];

beforeEach(() => {
  vi.clearAllMocks();
  readership.readershipYear.mockResolvedValue(year);
  readership.readWorks.mockResolvedValue({
    views: new Map([['Q22647', 300_000], ['Q43332', 200_000], ['Q184427', 100_000], ['Q56072866', 900_000]]),
    counted: new Map(),
  });
  readership.readAtLeast.mockResolvedValue(['Q21705206']);
});

describe('the items under the floor the readership names (ADR-0165)', () => {
  it('asks the year for the items read at the bar of the held tier, under the floor', async () => {
    expect(await readUnderFloor(held, 22, 15)).toEqual(['Q21705206']);
    expect(readership.readWorks).toHaveBeenCalledWith(year, ['Q22647', 'Q43332', 'Q184427', 'Q56072866']);
    expect(readership.readAtLeast).toHaveBeenCalledWith(year, 200_000, 15);
  });

  it('reads at the door\'s own percentiles: the finds door\'s 12th (ADR-0164)', async () => {
    await readUnderFloor(held, 22, 15, { enter: 0.12, stay: 0.08 });
    expect(readership.readAtLeast).toHaveBeenCalledWith(year, 124_000, 15);
  });

  it('names nothing while the year cannot be read', async () => {
    readership.readershipYear.mockResolvedValue(null);
    expect(await readUnderFloor(held, 22, 15)).toEqual([]);
    expect(readership.readAtLeast).not.toHaveBeenCalled();
  });

  it('names nothing when no item at the line was read, since the door then opens for nothing', async () => {
    readership.readWorks.mockResolvedValue({ views: new Map(), counted: new Map() });
    expect(await readUnderFloor(held, 22, 15)).toEqual([]);
    expect(readership.readAtLeast).not.toHaveBeenCalled();
  });
});
