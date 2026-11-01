import { afterEach, describe, expect, it, vi } from 'vitest';
import { datedDirectories, dumpNamed, md5Of, NotOnHost, sha1Of, wikipediaTableFile, wikiRunFile, type TextReader } from './catalog.js';

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

  it("takes English Wikivoyage's item usage from the newest run that has finished it (#1768)", async () => {
    const base = 'https://dumps.wikimedia.org/enwikivoyage';
    const status = (state: string) => JSON.stringify({ jobs: { wbcentityusagetable: { status: state, files: {
      'enwikivoyage-20261001-wbc_entity_usage.sql.gz': { size: 8857077, sha1: SHA },
    } } } });
    const read = pages({
      [`${base}/`]: '<a href="20260920/">a</a><a href="20261001/">b</a>',
      [`${base}/20261001/dumpstatus.json`]: status('done'),
    });
    const usage = dumpNamed('wikivoyage-usage')!;
    expect(await usage.resolve(read, noSize)).toMatchObject({
      fileName: 'enwikivoyage-20261001-wbc_entity_usage.sql.gz', date: '2026-10-01', expectedBytes: 8857077,
      checksum: { value: SHA }, compression: 'gzip',
    });
    const running = pages({ [`${base}/`]: '<a href="20261001/">b</a>', [`${base}/20261001/dumpstatus.json`]: status('in-progress') });
    expect(await usage.resolve(running, noSize)).toBeNull();
    expect(usage.isFileName('enwikivoyage-20261001-wbc_entity_usage.sql.gz')).toBe(true);
    expect(usage.isFileName('dewikivoyage-20261001-wbc_entity_usage.sql.gz')).toBe(false);
  });

  it("takes English Wikivoyage's articles from the newest run that has finished them, read as bzip2 (#2089)", async () => {
    const base = 'https://dumps.wikimedia.org/enwikivoyage';
    const status = (state: string) => JSON.stringify({ jobs: { articlesdump: { status: state, files: {
      'enwikivoyage-20261001-pages-articles.xml.bz2': { size: 131539958, sha1: SHA },
    } } } });
    const read = pages({
      [`${base}/`]: '<a href="20260920/">a</a><a href="20261001/">b</a>',
      [`${base}/20261001/dumpstatus.json`]: status('done'),
    });
    const articles = dumpNamed('wikivoyage-pages')!;
    expect(await articles.resolve(read, noSize)).toMatchObject({
      key: 'wikivoyage-pages', fileName: 'enwikivoyage-20261001-pages-articles.xml.bz2', date: '2026-10-01',
      expectedBytes: 131539958, checksum: { kind: 'sha1', value: SHA }, compression: 'bzip2',
    });
    const running = pages({ [`${base}/`]: '<a href="20261001/">b</a>', [`${base}/20261001/dumpstatus.json`]: status('in-progress') });
    expect(await articles.resolve(running, noSize)).toBeNull();
    expect(articles.isFileName('enwikivoyage-20261001-pages-articles.xml.bz2')).toBe(true);
    expect(articles.isFileName('enwikivoyage-20261001-pages-meta-current.xml.bz2')).toBe(false);
  });

  it('refuses a wiki name that is not a database name before building a URL from it', async () => {
    await expect(wikiRunFile(pages({}), 'wikivoyage-usage', '../enwikivoyage', '20261001', 'wbcentityusagetable', 'wbc_entity_usage.sql.gz', 'gzip'))
      .rejects.toThrow('Refusing');
    await expect(wikipediaTableFile(pages({}), 'wikipedia-redirects', 'enwikivoyage', '20261001', 'redirecttable', 'redirect'))
      .rejects.toThrow('Refusing');
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

  it('finds a month asked for by name in its own directory, in any year the host lists, reading no year\'s listing (#2230)', async () => {
    const base = 'https://dumps.wikimedia.org/other/pageview_complete/monthly';
    const read = pages({ [`${base}/`]: '<a href="2023/">a</a><a href="2024/">b</a><a href="2025/">c</a><a href="2026/">d</a>' });
    const asked: string[] = [];
    const size = async (url: string) => { asked.push(url); return 5_900_000_000; };
    expect(await dumpNamed('pageviews-user')!.resolve(read, size, name => name === 'pageviews-202311-user.bz2')).toMatchObject({
      fileName: 'pageviews-202311-user.bz2', url: `${base}/2023/2023-11/pageviews-202311-user.bz2`, date: '2023-11-01',
    });
    expect(asked).toEqual([`${base}/2023/2023-11/pageviews-202311-user.bz2`]);
    // A month of a year the host no longer lists is not found.
    expect(await dumpNamed('pageviews-user')!.resolve(read, size, name => name === 'pageviews-202211-user.bz2')).toBeNull();
  });

  describe("OpenStreetMap's planet (ADR-0134)", () => {
    const base = 'https://planet.openstreetmap.org/pbf';
    const MD5 = 'c51bb08eb9fc486d010aaa1a3424cabc';
    afterEach(() => vi.useRealTimers());

    it("reads a file's md5 from its .md5, and nothing for a file it does not name", () => {
      expect(md5Of(`${MD5}  planet-261012.osm.pbf\n`, 'planet-261012.osm.pbf')).toBe(MD5);
      expect(md5Of(`${MD5}  planet-latest.osm.pbf\n`, 'planet-261012.osm.pbf')).toBeNull();
      expect(md5Of('', 'planet-261012.osm.pbf')).toBeNull();
    });

    it("takes the most recent Monday's planet whose md5 is published, without reading a listing", async () => {
      // Thursday 2026-10-22: the planet of Monday the 19th is not out yet.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-22T08:00:00Z'));
      const asked: string[] = [];
      const read: TextReader = async (url) => {
        asked.push(url);
        if (url === `${base}/planet-261012.osm.pbf.md5`) return `${MD5}  planet-261012.osm.pbf\n`;
        throw new NotOnHost(`${url} answered 404`);
      };
      const size = async () => 95380942829;
      expect(await dumpNamed('osm-planet')!.resolve(read, size)).toEqual({
        key: 'osm-planet', fileName: 'planet-261012.osm.pbf', url: `${base}/planet-261012.osm.pbf`, date: '2026-10-12',
        checksum: { kind: 'md5', value: MD5 }, expectedBytes: 95380942829, compression: 'none',
      });
      expect(asked).toEqual([`${base}/planet-261019.osm.pbf.md5`, `${base}/planet-261012.osm.pbf.md5`]);
    });

    it('fails on a host that is down or limiting rather than take an older planet', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-22T08:00:00Z'));
      const read: TextReader = async (url) => {
        if (url.endsWith('planet-261019.osm.pbf.md5')) throw new Error(`${url} answered 429`);
        return `${MD5}  planet-261012.osm.pbf\n`;
      };
      await expect(dumpNamed('osm-planet')!.resolve(read, async () => null)).rejects.toThrow('answered 429');
      const garbled: TextReader = async () => '<html>maintenance</html>';
      await expect(dumpNamed('osm-planet')!.resolve(garbled, async () => null)).rejects.toThrow('gives no md5 for planet-261019.osm.pbf');
    });

    it('resolves a local copy by its own name, and answers none past the weeks it looks back', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-19T00:30:00Z'));
      const read: TextReader = async (url) => {
        const name = /planet-(\d{6})\.osm\.pbf\.md5$/.exec(url)?.[1];
        return `${MD5}  planet-${name}.osm.pbf\n`;
      };
      const planet = dumpNamed('osm-planet')!;
      expect(await planet.resolve(read, async () => null, name => name === 'planet-261005.osm.pbf'))
        .toMatchObject({ fileName: 'planet-261005.osm.pbf', date: '2026-10-05', expectedBytes: null });
      // Six weeks before Monday 2026-10-19 is 2026-09-07, the last Monday it looks at.
      expect(await planet.resolve(read, async () => null, name => name === 'planet-260907.osm.pbf')).toMatchObject({ date: '2026-09-07' });
      expect(await planet.resolve(read, async () => null, name => name === 'planet-260831.osm.pbf')).toBeNull();
    });
  });

  it('tells a dump\'s own dated files from anything else in the dumps directory (#1456)', () => {
    const entities = dumpNamed('wikidata-entities')!;
    expect(entities.isFileName('wikidata-20261005-all.json.gz')).toBe(true);
    expect(entities.isFileName('wikidata-20261005-lexemes.json.gz')).toBe(false);
    expect(entities.isFileName('wikidata-2026100-all.json.gz')).toBe(false);
    expect(entities.isFileName('wikidata-20261005-all.json.gz.part')).toBe(false);
    expect(dumpNamed('enwiki-page')!.isFileName('enwiki-20261001-page.sql.gz')).toBe(true);
    expect(dumpNamed('enwiki-page')!.isFileName('enwiki-20261001-page_props.sql.gz')).toBe(false);
    expect(dumpNamed('pageviews-user')!.isFileName('pageviews-202609-user.bz2')).toBe(true);
    expect(dumpNamed('osm-planet')!.isFileName('planet-261012.osm.pbf')).toBe(true);
    expect(dumpNamed('osm-planet')!.isFileName('planet-latest.osm.pbf')).toBe(false);
    expect(dumpNamed('osm-planet')!.isFileName('planet-261012.osm.pbf.md5')).toBe(false);
  });
});
