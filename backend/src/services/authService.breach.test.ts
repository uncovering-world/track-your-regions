/**
 * The breached-password check against Have I Been Pwned (#2356): only the
 * hash's first five characters leave the server, the answer is padded so its
 * size says nothing of them, a padded line is no breach, and a host that is
 * slow or down never holds a registration or a password change.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { BREACH_CHECK_TIMEOUT_MS, checkBreachedPassword } from './authService.js';

const PASSWORD = 'password';
/** The SHA-1 of "password", the protocol's own hash, written out rather than computed here. */
const [PREFIX, SUFFIX] = ['5BAA6', '1E4C9B93F3F0682250B6CF8331B7EE68FD8'];

const answering = (body: string) => vi.fn<typeof fetch>(async () => new Response(body, { status: 200 }));

afterEach(() => vi.unstubAllGlobals());

describe('checkBreachedPassword', () => {
  it('asks for the prefix only, padded, and under a timeout', async () => {
    const fetchImpl = answering('');
    vi.stubGlobal('fetch', fetchImpl);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await checkBreachedPassword(PASSWORD);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
    expect((init.headers as Record<string, string>)['Add-Padding']).toBe('true');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(BREACH_CHECK_TIMEOUT_MS);
    timeout.mockRestore();
  });

  it('answers the count of a breached password, and 0 for a padded line that happens to match', async () => {
    vi.stubGlobal('fetch', answering(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${SUFFIX}:3861493\r\n`));
    expect(await checkBreachedPassword(PASSWORD)).toBe(3861493);
    vi.stubGlobal('fetch', answering(`${SUFFIX}:0\r\n`));
    expect(await checkBreachedPassword(PASSWORD)).toBe(0);
  });

  it('fails open when the host does not answer in time', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }));
    expect(await checkBreachedPassword(PASSWORD)).toBe(0);
  });
});
