import { describe, expect, it, vi } from 'vitest';

/**
 * The write pass is refused when a disk cannot hold it (#1466): the spool on
 * its directory's disk, the tables on the database's, both on one disk where
 * they share it.
 */

const disks = vi.hoisted(() => new Map<string, { device: number; blocks: number; bsize: number; free: number }>());
vi.mock('../localCopies.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../localCopies.js')>()),
  diskOf: async (dir: string) => disks.get(dir)!,
}));

const { assertRoomForCopies, assertRoomToWrite } = await import('./diskRoom.js');

const GB = 1024 ** 3;
// 200 GB of kept lines make 90 GB of tables; 2,000 GB of others make a 10 GB spool.
const counts = { bytes: 2200 * GB, keptBytes: 200 * GB };

describe('room for the subset build to write (#1466)', () => {
  it('lets the build write when each disk holds its share and the headroom', async () => {
    disks.set('/app/data/dumps', { device: 1, blocks: 100, bsize: 4096, free: 31 * GB });
    disks.set('/app/db-disk', { device: 2, blocks: 200, bsize: 4096, free: 111 * GB });
    await expect(assertRoomToWrite('/app/data/dumps', counts, '/app/db-disk')).resolves.toEqual([]);
  });

  it('refuses when the database\'s disk cannot hold the tables, though the spool\'s disk has room', async () => {
    disks.set('/app/data/dumps', { device: 1, blocks: 100, bsize: 4096, free: 500 * GB });
    disks.set('/app/db-disk', { device: 2, blocks: 200, bsize: 4096, free: 100 * GB });
    await expect(assertRoomToWrite('/app/data/dumps', counts, '/app/db-disk'))
      .rejects.toThrow('The subset would write about 90 GB to the disk of /app/db-disk and keep 20 GB free, but it has 100 GB');
  });

  it('adds both up when the spool and the database share a disk', async () => {
    disks.set('/app/data/dumps', { device: 1, blocks: 100, bsize: 4096, free: 115 * GB });
    disks.set('/app/db-disk', { device: 1, blocks: 100, bsize: 4096, free: 115 * GB });
    await expect(assertRoomToWrite('/app/data/dumps', counts, '/app/db-disk')).rejects.toThrow(/about 100 GB/);
  });

  it('adds both up when the spool is on an overlay over the database\'s disk', async () => {
    disks.set('/tmp', { device: 7, blocks: 100, bsize: 4096, free: 115 * GB });
    disks.set('/app/db-disk', { device: 1, blocks: 100, bsize: 4096, free: 115 * GB });
    await expect(assertRoomToWrite('/tmp', counts, '/app/db-disk')).rejects.toThrow(/about 100 GB/);
  });

  it('checks against the smaller free space when two disks of one size read as one', async () => {
    disks.set('/app/data/dumps', { device: 3, blocks: 500, bsize: 4096, free: 900 * GB });
    disks.set('/app/db-disk', { device: 4, blocks: 500, bsize: 4096, free: 50 * GB });
    await expect(assertRoomToWrite('/app/data/dumps', counts, '/app/db-disk')).rejects.toThrow('about 100 GB to the disk of /app/data/dumps and /app/db-disk and keep 20 GB free, but it has 50 GB');
  });

  it('asks only for what is left to write when a build picks up after an earlier one (#1493)', async () => {
    disks.set('/app/data/dumps', { device: 1, blocks: 100, bsize: 4096, free: 31 * GB });
    disks.set('/app/db-disk', { device: 2, blocks: 200, bsize: 4096, free: 40 * GB });
    await expect(assertRoomToWrite('/app/data/dumps', counts, '/app/db-disk')).rejects.toThrow(/about 90 GB/);
    await expect(assertRoomToWrite('/app/data/dumps', counts, '/app/db-disk', { tables: 80 * GB, spool: 8 * GB })).resolves.toEqual([]);
  });

  it('says it could not check the database\'s disk when no path on it is named', async () => {
    disks.set('/app/data/dumps', { device: 1, blocks: 100, bsize: 4096, free: 500 * GB });
    // Empty, not undefined: undefined takes the default, DB_DISK_DIR, which compose sets.
    await expect(assertRoomToWrite('/app/data/dumps', counts, '')).resolves.toEqual([
      'the database\'s disk was not checked: DB_DISK_DIR names no path on it',
    ]);
  });
});

describe('room for a re-derive\'s copies of the derived tables (#1526)', () => {
  it('lets it write what the live tables take when the database\'s disk holds that and the headroom', async () => {
    disks.set('/app/db-disk', { device: 2, blocks: 200, bsize: 4096, free: 71 * GB });
    await expect(assertRoomForCopies(50 * GB, '/app/db-disk')).resolves.toEqual([]);
  });

  it('refuses, naming the figures, when it cannot', async () => {
    disks.set('/app/db-disk', { device: 2, blocks: 200, bsize: 4096, free: 69 * GB });
    await expect(assertRoomForCopies(50 * GB, '/app/db-disk'))
      .rejects.toThrow('Deriving the tables again would write about 50 GB to the disk of /app/db-disk and keep 20 GB free, but it has 69 GB');
  });

  it('says it could not check when no path on the database\'s disk is named', async () => {
    await expect(assertRoomForCopies(50 * GB, '')).resolves.toEqual(['the database\'s disk was not checked: DB_DISK_DIR names no path on it']);
  });
});
