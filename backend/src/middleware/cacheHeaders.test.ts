import { describe, it, expect, vi } from 'vitest';
import { markPublicReferenceBody, markStreamBody, markTokenResponse } from './cacheHeaders.js';

function makeRes() {
  return { setHeader: vi.fn() };
}

/**
 * The three helpers a handler calls when `requireAuth`'s `private, no-store`
 * is not what its response should carry (#710), for three different reasons.
 * A public reference body sits behind the middleware and needs a different
 * value. A stream sits behind it too and must replace the whole header, so it
 * says `private` back explicitly — for a caller whose token rides in the query
 * string, that is the whole of the guarantee. A token response mostly sits
 * *ahead* of the middleware and needs the same value said where it never runs,
 * with the `Pragma` RFC 6749 § 5.1 asks for. `cacheOverrides.test.ts` holds
 * that the handlers still call these; this holds what the calls do.
 */
describe('markPublicReferenceBody', () => {
  it('keeps the browser its revalidation, and the response out of a shared cache', () => {
    const res = makeRes();
    markPublicReferenceBody(res as never);

    // `no-cache`, not a max-age: the browser stores the body and revalidates
    // every use, so the origin re-authorizes each one. `private` stays,
    // because replacing the header would otherwise drop it with the no-store.
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
  });
});

describe('markTokenResponse', () => {
  it('refuses every cache and says so in both fields RFC 6749 § 5.1 names', () => {
    const res = makeRes();
    markTokenResponse(res as never);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    // Deprecated for responses by RFC 9111 § 5.4 and read by nothing in this
    // stack; it is here because 6749 asks for it, and an auditor reading these
    // five responses should not have to take the method's word for it.
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
  });
});

describe('markStreamBody', () => {
  it('keeps a stream cacheable only by the caller that opened it', () => {
    const res = makeRes();
    markStreamBody(res as never);

    // The value EventSource proxies expect, with the `private` that is the
    // whole guarantee for a caller whose token rides in the query string.
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
  });
});
