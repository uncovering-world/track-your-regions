/**
 * The classifier asks Commons once per file, fifty a request, keeps the answer
 * for a day, and leaves a file it could not ask about not classed (#2192).
 */

import { describe, it, expect, vi } from 'vitest';
import { userAgent } from '../../config/userAgent.js';
import { CACHE_TTL_MS, createPictureClassifier } from './pictureClasses.js';

const BANQIAO = 'https://upload.wikimedia.org/wikipedia/commons/3/3a/Banqiaomap.png';
const HERMITAGE = 'https://commons.wikimedia.org/wiki/Special:FilePath/Hermitage.jpg';
const SUN_STONE = 'https://upload.wikimedia.org/wikipedia/commons/1/1a/Aztec_Solar_Disk_Calendar.svg';

function commons(pages: Array<{ title: string; mime?: string; categories?: string; missing?: boolean }>) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ query: { pages: pages.map(page => ({
      title: page.title, missing: page.missing,
      imageinfo: page.missing ? undefined : [{ mime: page.mime, extmetadata: page.categories === undefined ? {} : { Categories: { value: page.categories } } }],
    })) } }),
  })) as unknown as typeof fetch;
}

describe("what a card's pictures are, asked of Commons", () => {
  it('asks once for every file, reads the MIME type and the categories, and answers each picture for what it is of', async () => {
    const fetchFn = commons([
      { title: 'File:Banqiaomap.png', mime: 'image/png', categories: 'Banqiao Dam|Maps of dams in China' },
      { title: 'File:Hermitage.jpg', mime: 'image/jpeg', categories: 'Hermitage Museum' },
      { title: 'File:Aztec Solar Disk Calendar.svg', mime: 'image/svg+xml' },
    ]);
    const classify = createPictureClassifier({ fetch: fetchFn, robots: async () => {}, now: () => 1_000 });

    const place = { kind: 'place' as const };
    const classes = await classify([
      { url: BANQIAO, subject: place }, { url: HERMITAGE, subject: place },
      { url: SUN_STONE, subject: { kind: 'work', type: 'sculpture' } }, { url: 'https://example.org/not-commons.jpg', subject: place },
    ]);

    expect(classes).toEqual([
      { url: BANQIAO, class: 'map', basis: 'Maps of dams in China', checkedAt: '1970-01-01T00:00:01.000Z' },
      { url: HERMITAGE, class: 'photograph', basis: 'image/jpeg', checkedAt: '1970-01-01T00:00:01.000Z' },
      { url: SUN_STONE, class: 'drawing', basis: 'image/svg+xml', checkedAt: '1970-01-01T00:00:01.000Z' },
      { url: 'https://example.org/not-commons.jpg', class: null, basis: null, checkedAt: '1970-01-01T00:00:01.000Z' },
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [address, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const params = new URL(address).searchParams;
    expect(new URL(address).origin + new URL(address).pathname).toBe('https://commons.wikimedia.org/w/api.php');
    expect(params.get('iiprop')).toBe('extmetadata|mime');
    expect(params.get('iiextmetadatafilter')).toBe('Categories');
    expect(params.get('titles')).toBe('File:Banqiaomap.png|File:Hermitage.jpg|File:Aztec Solar Disk Calendar.svg');
    // The one User-Agent the backend sends (userAgentOneSource.test.ts spells the name nowhere else).
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(userAgent());
  });

  it("finds its answer under the title Commons gives, whatever the address spells", async () => {
    // A stored address may spell the first letter lower-case or with underscores;
    // Commons titles the file "File:Banqiaomap.png" either way.
    const fetchFn = commons([{ title: 'File:Banqiaomap.png', mime: 'image/png', categories: 'Maps of dams in China' }]);
    const classify = createPictureClassifier({ fetch: fetchFn, robots: async () => {}, now: () => 1_000 });
    const spelled = 'https://upload.wikimedia.org/wikipedia/commons/3/3a/banqiaomap.png';

    expect((await classify([{ url: spelled, subject: { kind: 'place' } }]))[0]).toMatchObject({ class: 'map' });
    await classify([{ url: spelled, subject: { kind: 'place' } }]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(new URL((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string).searchParams.get('titles')).toBe('File:Banqiaomap.png');
  });

  it('keeps an answer for a day and asks again after it', async () => {
    let clock = 1_000;
    const fetchFn = commons([{ title: 'File:Banqiaomap.png', mime: 'image/png', categories: 'Maps of dams in China' }]);
    const classify = createPictureClassifier({ fetch: fetchFn, robots: async () => {}, now: () => clock });

    const banqiao = [{ url: BANQIAO, subject: { kind: 'place' as const } }];
    await classify(banqiao);
    await classify(banqiao);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    clock += CACHE_TTL_MS + 1;
    await classify(banqiao);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('leaves a file Commons does not know, or could not be asked about, not classed and asks again next time', async () => {
    const failing = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const classify = createPictureClassifier({ fetch: failing, robots: async () => {}, now: () => 1_000 });
    const banqiao = [{ url: BANQIAO, subject: { kind: 'place' as const } }];
    expect(await classify(banqiao)).toEqual([{ url: BANQIAO, class: null, basis: null, checkedAt: '1970-01-01T00:00:01.000Z' }]);
    await classify(banqiao);
    expect(failing).toHaveBeenCalledTimes(2);

    const missing = createPictureClassifier({ fetch: commons([{ title: 'File:Banqiaomap.png', missing: true }]), robots: async () => {}, now: () => 1_000 });
    expect((await missing(banqiao))[0]).toMatchObject({ class: null, basis: null });
  });
});
