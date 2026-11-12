import { describe, expect, it } from 'vitest';
import { passedStatus, unreachedStatus } from './outsideStatus.js';

describe("a route's status for an outside service's failure (#2428)", () => {
  it('is 504 where its own deadline ran out and 502 otherwise, never 500', () => {
    expect(unreachedStatus(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe(504);
    expect(unreachedStatus(new TypeError('fetch failed'))).toBe(502);
    expect(unreachedStatus('not an error')).toBe(502);
  });

  it("passes a refusal on with its status, and makes the service's own server error a 502", () => {
    expect(passedStatus(429)).toBe(429);
    expect(passedStatus(404)).toBe(404);
    expect(passedStatus(500)).toBe(502);
    expect(passedStatus(503)).toBe(502);
  });
});
