import { describe, expect, it } from 'vitest';
import { HostAnswered, hostFailure, networkFailure, RequestFailed } from './fetch.js';
import { RangeEndedEarly } from './rangedDownload.js';

/**
 * Which failures of a request are the network's, and so worth a build's
 * retry (#2419): the shapes undici and Node gave on 2026-11-10, when the
 * development stack's name resolution went and dumps.wikimedia.org closed
 * long downloads mid-file.
 */

const coded = (code: string, message = code) => Object.assign(new Error(message), { code });

describe('a failure of the network, told from a refusal or a damaged file', () => {
  it('reads a connection the host closed, as undici reports it, as closed', () => {
    const terminated = new TypeError('terminated', { cause: coded('UND_ERR_SOCKET', 'other side closed') });
    expect(networkFailure(terminated)).toBe('closed');
    expect(networkFailure(coded('ECONNRESET'))).toBe('closed');
    expect(networkFailure(new RangeEndedEarly('a range ended at byte 10 of 20'))).toBe('closed');
  });

  it('reads a name that did not resolve, or a host that did not answer, as unreachable', () => {
    expect(networkFailure(new TypeError('fetch failed', { cause: coded('EAI_AGAIN', 'getaddrinfo EAI_AGAIN dumps.wikimedia.org') })))
      .toBe('unreachable');
    expect(networkFailure(coded('ECONNREFUSED'))).toBe('unreachable');
  });

  it("reads a host's 502 to 504 as trouble for now, and never a refusal or a damaged file", () => {
    expect(networkFailure(new HostAnswered('https://dumps.wikimedia.org/x', 503))).toBe('host-trouble');
    expect(networkFailure(new HostAnswered('https://dumps.wikimedia.org/x', 403))).toBeNull();
    expect(networkFailure(new HostAnswered('https://dumps.wikimedia.org/x', 429))).toBeNull();
    expect(networkFailure(coded('Z_DATA_ERROR', 'incorrect header check'))).toBeNull();
    expect(networkFailure(new Error('x.gz: sha1 1 is not the published 2'))).toBeNull();
  });

  it('names the host of a request the network failed before it answered, and still reads it as the network\'s', () => {
    const dns = new TypeError('fetch failed', { cause: coded('EAI_AGAIN', 'getaddrinfo EAI_AGAIN dumps.wikimedia.org') });
    const failed = new RequestFailed('https://dumps.wikimedia.org/wikidatawiki/', 'unreachable', dns);
    expect(failed.message).toBe('dumps.wikimedia.org could not be reached');
    expect(networkFailure(failed)).toBe('unreachable');
  });

  it("reads only a request's failure as the host's, never the same codes from the build's own writes", () => {
    expect(hostFailure(coded('ECONNRESET'))).toBeNull();
    expect(hostFailure(new RequestFailed('https://dumps.wikimedia.org/x', 'closed', coded('ECONNRESET')))).toBe('closed');
    expect(hostFailure(new HostAnswered('https://dumps.wikimedia.org/x', 503))).toBe('host-trouble');
    expect(hostFailure(new RangeEndedEarly('a range ended early'))).toBe('closed');
  });
});
