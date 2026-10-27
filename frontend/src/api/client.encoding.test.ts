import { describe, expect, it } from 'vitest';
import {
  getPutAdminAiSettingsByKeyUrl, getPutAdminSyncSourcesBySourceIdCacheByKindTtlUrl,
} from './adminClient.generated';

/**
 * A string path parameter is encoded into the path it is written into
 * (`urlEncodeParameters`, `scripts/api-client.mjs`). A Wikidata cache kind or
 * an AI setting's key holding `/`, `?` or `#` would
 * otherwise name another route, or end the path early.
 */
describe('the generated client’s path parameters', () => {
  it('encode a character that would break the path', () => {
    expect(getPutAdminAiSettingsByKeyUrl('model/web search'))
      .toBe('/api/admin/ai/settings/model%2Fweb%20search');
    expect(getPutAdminSyncSourcesBySourceIdCacheByKindTtlUrl(4, 'site/images'))
      .toBe('/api/admin/sync/sources/4/cache/site%2Fimages/ttl');
  });
});
