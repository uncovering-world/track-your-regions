import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The User-Agent is spelled in one file, and nowhere else.
 *
 * Before #864 it was written at each call site, and a new outbound call copied
 * the nearest existing one: six spellings across fifteen files, three of them
 * publishing a contact that answered 404 or did not resolve. Nothing failed
 * loudly — a header only matters to the server reading it, and Wikimedia's
 * policy says such a caller "may be blocked without notice" — so the drift ran
 * for as long as nobody grepped.
 *
 * This is the grep, run by the gate. It holds `backend/src` and the canonical
 * schema to one home for the string: `config/userAgent.ts` builds it, everyone
 * else asks. `db/migrations/` is deliberately outside the scan — those files
 * are applied history, checksummed in `schema_migrations`, and 050 seeded the
 * key that migration 053 removes.
 *
 * A guard of the kind Epic #788 sets out to retire: the rule's real home is the
 * one module, and this only keeps a second home from appearing.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));
const SCHEMA_PATH = fileURLToPath(new URL('../../../db/init/01-schema.sql', import.meta.url));

/** The module that owns the string, and the two test files that quote it on purpose. */
const OWNERS = new Set([
  join('config', 'userAgent.ts'),
  join('config', 'userAgent.test.ts'),
  join('config', 'userAgentOneSource.test.ts'),
]);

/** The client name, assembled so this file does not itself contain the literal. */
const CLIENT = ['Track', 'Your', 'Regions'].join('');

function typescriptFiles(dir: string): string[] {
  const found: string[] = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- recursion from a literal root inside this package
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...typescriptFiles(full));
    else if (entry.name.endsWith('.ts')) found.push(full);
  }
  return found;
}

describe('the User-Agent has one home', () => {
  const files = typescriptFiles(SRC);

  it('scans the whole backend source tree', () => {
    // A walker that quietly stopped finding files would pass every assertion
    // below on nothing at all.
    expect(files.length).toBeGreaterThan(300);
  });

  it('spells the client name only in the module that builds the header', () => {
    const offenders = files
      .map(file => relative(SRC, file))
      .filter(rel => !OWNERS.has(rel))
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- enumerated from a literal root
      .filter(rel => readFileSync(join(SRC, rel), 'utf8').includes(CLIENT));
    expect(offenders).toEqual([]);
  });

  it('keeps the header out of the seeded source rows', () => {
    // A run's header is code's answer; api_config carries what a run reads.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a literal path resolved against this module's own URL
    expect(readFileSync(SCHEMA_PATH, 'utf8')).not.toContain('userAgent');
  });
});
