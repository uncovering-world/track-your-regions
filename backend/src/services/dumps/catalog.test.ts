import { describe, expect, it } from 'vitest';
import { datedDirectories, dumpNamed, sha1Of, type TextReader } from './catalog.js';

/**
 * Finding the newest complete file of each dump (ADR-0101): a dated directory
 * whose checksum is published, never a `latest-` link, against listings shaped
 * as dumps.wikimedia.org answered them on 2026-10-13.
 */

const SHA = 'a'.repeat(40);
const pages = (map: Record<string, string>): TextReader => async (url) => {
  if (!(url in map)) throw new Error(`404 ${url}`);
  return map[url];
};
const noSize = async () => 1234;

describe('the dump catalog', () => {
  it('reads the dated directories of a listing, newest first', () => {
    expect(datedDirectories('<a href="../">..</a><a href="20261007/">x</a><a href="20261012/">y</a><a href="latest-all.json.gz">z</a>'))
      .toEqual(['20261012', '20261007']);
  });

  it("reads a file's sha1 from a sums file, and nothing for a file it does not list", () => {
    const sums = `${SHA}  wikidata-20261012-all.json.gz\n${'b'.repeat(40)}  wikidata-20261012-all.json.bz2\n`;
    expect(sha1Of(sums, 'wikidata-20261012-all.json.gz')).toBe(SHA);
    expect(sha1Of(sums, 'wikidata-20261012-lexemes.json.gz')).toBeNull();
  });

  it('takes the newest dated Wikidata directory whose sums list the file, passing over one still being written', async () => {
    const base = 'https://dumps.wikimedia.org/wikidatawiki/entities';
    const read = pages({
      [`${base}/`]: '<a href="20261005/">a</a><a href="20261012/">b</a>',
      [`${base}/20261012/wikidata-20261012-sha1sums.txt`]: '',
      [`${base}/20261005/wikidata-20261005-sha1sums.txt`]: `${SHA}  wikidata-20261005-all.json.gz\n`,
    });
    expect(await dumpNamed('wikidata-entities')!.resolve(read, noSize)).toEqual({
      key: 'wikidata-entities', fileName: 'wikidata-20261005-all.json.gz',
      url: `${base}/20261005/wikidata-20261005-all.json.gz`, date: '2026-10-05',
      checksum: { kind: 'sha1', value: SHA }, expectedBytes: 1234, compression: 'gzip',
    });
  });

  it("takes an English Wikipedia table from the newest run whose dumpstatus says it is done", async () => {
    const base = 'https://dumps.wikimedia.org/enwiki';
    const status = (state: string) => JSON.stringify({ jobs: { pagepropstable: { status: state, files: {
      'enwiki-20261001-page_props.sql.gz': { size: 483959463, sha1: SHA },
    } } } });
    const read = pages({
      [`${base}/`]: '<a href="20260920/">a</a><a href="20261001/">b</a>',
      [`${base}/20261001/dumpstatus.json`]: status('done'),
    });
    expect(await dumpNamed('enwiki-page-props')!.resolve(read, noSize)).toMatchObject({
      fileName: 'enwiki-20261001-page_props.sql.gz', date: '2026-10-01', expectedBytes: 483959463, checksum: { value: SHA },
    });
    const running = pages({ [`${base}/`]: '<a href="20261001/">b</a>', [`${base}/20261001/dumpstatus.json`]: status('in-progress') });
    expect(await dumpNamed('enwiki-page-props')!.resolve(running, noSize)).toBeNull();
  });

  it('takes the newest monthly pageview file the host answers a size for, with no checksum', async () => {
    const base = 'https://dumps.wikimedia.org/other/pageview_complete/monthly';
    const read = pages({
      [`${base}/`]: '<a href="2025/">a</a><a href="2026/">b</a>',
      [`${base}/2026/`]: '<a href="2026-08/">a</a><a href="2026-09/">b</a><a href="2026-10/">c</a>',
    });
    const size = async (url: string) => (url.includes('2026-10') ? null : 6326820535);
    expect(await dumpNamed('pageviews-user')!.resolve(read, size)).toMatchObject({
      fileName: 'pageviews-202609-user.bz2', date: '2026-09-01', checksum: null, expectedBytes: 6326820535, compression: 'bzip2',
    });
  });
});
