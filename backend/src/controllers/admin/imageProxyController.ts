/**
 * The image proxy: a Wikimedia Commons picture the editor draws as a map
 * overlay, fetched through the backend because Commons does not answer the
 * browser's cross-origin request with the headers a canvas needs (ADR-0071).
 */

import type { z } from 'zod/v4';
import type { ImageBody } from '../../api/route.js';
import { badRequest, failure } from '../../middleware/errorHandler.js';
import { fetchPicture } from '../../services/pictureFetch.js';
import type { imageProxyQuerySchema } from '../../types/index.js';

/** GET /api/admin/image-proxy?url=… — the picture, unchanged. */
export async function proxyImage(
  { query: { url } }: { query: z.output<typeof imageProxyQuerySchema> },
): Promise<ImageBody> {
  let response: Awaited<ReturnType<typeof fetchPicture>>;
  try {
    response = await fetchPicture(url, 'admin image proxy');
  } catch (err) {
    console.error('Image proxy error:', err);
    throw failure('Failed to fetch image', 502);
  }
  if (!response) throw failure('Upstream redirected off Wikimedia Commons', 502);
  if (!response.ok) throw failure('Upstream image fetch failed', response.status);

  // The type is read from the headers, so a page that is not a picture is
  // refused before its body is downloaded.
  const contentType = response.headers.get('content-type') || 'image/png';
  if (!contentType.startsWith('image/')) throw badRequest('URL did not return an image');
  try {
    return { contentType, bytes: Buffer.from(await response.arrayBuffer()) };
  } catch (err) {
    console.error('Image proxy error:', err);
    throw failure('Failed to fetch image', 502);
  }
}
