/**
 * Tests for the development fixture source.
 *
 * This exists so a sync can be exercised without hammering UNESCO or Wikidata.
 * It must be inert in production and must not read outside its directory —
 * an env var is operator-controlled, but a path is still a path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import { fixtureSourcePath, readFixtureRecords, FIXTURE_ENV_VAR } from './fixtureSource.js';

const mockedReadFile = readFile as unknown as ReturnType<typeof vi.fn>;

describe('fixtureSourcePath', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockedReadFile.mockReset();
    delete process.env[FIXTURE_ENV_VAR];
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('is inactive when the variable is unset', () => {
    expect(fixtureSourcePath()).toBeNull();
  });

  it('is inactive in production even when the variable is set', () => {
    process.env.NODE_ENV = 'production';
    process.env[FIXTURE_ENV_VAR] = '/srv/fixtures';

    expect(fixtureSourcePath()).toBeNull();
  });

  it('returns the configured directory outside production', () => {
    process.env[FIXTURE_ENV_VAR] = '/srv/fixtures';

    expect(fixtureSourcePath()).toBe('/srv/fixtures');
  });
});

describe('readFixtureRecords', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockedReadFile.mockReset();
    process.env.NODE_ENV = 'test';
    process.env[FIXTURE_ENV_VAR] = '/srv/fixtures';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns null when no fixture directory is configured', async () => {
    delete process.env[FIXTURE_ENV_VAR];

    expect(await readFixtureRecords('unesco.json')).toBeNull();
  });

  it('reads and parses a fixture file', async () => {
    mockedReadFile.mockResolvedValueOnce('[{"id_no": "156"}]');

    const records = await readFixtureRecords<{ id_no: string }>('unesco.json');

    expect(records).toEqual([{ id_no: '156' }]);
    expect(String(mockedReadFile.mock.calls[0][0])).toBe('/srv/fixtures/unesco.json');
  });

  it('refuses a fixture that is not an array, naming the likely mistake', async () => {
    // The raw UNESCO response shape — cast blindly this becomes zero items and
    // a run recorded as a clean success
    mockedReadFile.mockResolvedValueOnce('{"total_count": 2, "results": [{"id_no": "156"}]}');

    await expect(readFixtureRecords('unesco.json')).rejects.toThrow(/must be a JSON array/);
  });

  it('names the keys it found, so the mistake is obvious', async () => {
    mockedReadFile.mockResolvedValueOnce('{"results": []}');

    await expect(readFixtureRecords('unesco.json')).rejects.toThrow(/results/);
  });

  it('refuses a file name that escapes the fixture directory', async () => {
    await expect(readFixtureRecords('../../etc/passwd')).rejects.toThrow(/fixture/i);
    expect(mockedReadFile).not.toHaveBeenCalled();
  });

  it('refuses a file name with a path separator', async () => {
    await expect(readFixtureRecords('nested/file.json')).rejects.toThrow(/fixture/i);
    expect(mockedReadFile).not.toHaveBeenCalled();
  });
});
