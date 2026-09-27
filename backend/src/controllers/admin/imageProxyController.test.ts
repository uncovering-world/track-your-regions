/**
 * The image proxy answers a Commons picture unchanged, and refuses anything
 * else by its headers, before its body is downloaded.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/pictureFetch.js', () => ({ fetchPicture: vi.fn() }));

import { fetchPicture } from '../../services/pictureFetch.js';
import { proxyImage } from './imageProxyController.js';

const URL_ = 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg';

function upstream(status: number, contentType: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': contentType }),
    arrayBuffer: vi.fn(async () => new TextEncoder().encode('jpeg').buffer),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the image proxy', () => {
  it('answers the picture under its own type', async () => {
    vi.mocked(fetchPicture).mockResolvedValue(upstream(200, 'image/jpeg') as unknown as Response);
    const image = await proxyImage({ query: { url: URL_ } });
    expect(image.contentType).toBe('image/jpeg');
    expect(image.bytes.toString()).toBe('jpeg');
  });

  it('refuses a page that is not a picture without downloading it', async () => {
    const page = upstream(200, 'text/html');
    vi.mocked(fetchPicture).mockResolvedValue(page as unknown as Response);
    await expect(proxyImage({ query: { url: URL_ } }))
      .rejects.toMatchObject({ statusCode: 400, message: 'URL did not return an image' });
    expect(page.arrayBuffer).not.toHaveBeenCalled();
  });

  it('passes an upstream failure on under its status', async () => {
    vi.mocked(fetchPicture).mockResolvedValue(upstream(404, 'text/html') as unknown as Response);
    await expect(proxyImage({ query: { url: URL_ } }))
      .rejects.toMatchObject({ statusCode: 404, message: 'Upstream image fetch failed' });
  });

  it('is a 502 where the upstream redirected off Commons', async () => {
    vi.mocked(fetchPicture).mockResolvedValue(null);
    await expect(proxyImage({ query: { url: URL_ } }))
      .rejects.toMatchObject({ statusCode: 502, message: 'Upstream redirected off Wikimedia Commons' });
  });
});
