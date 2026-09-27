import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL, setAccessToken } from './fetchUtils';
import { computeRegionGeometryWithProgress } from './geometry';

/**
 * The compute stream is an `EventSource`, which the browser fetches by itself
 * and sends no headers with (ADR-0073 decision 5). So its URL is the API's
 * origin followed by the path the generated builder returns, the token rides
 * in the query, and a flag goes only when it is set.
 */
interface FakeStream {
  url: string;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  closed: boolean;
  close: () => void;
}

// A constructor that returns an object hands that object to `new`.
const FakeEventSource = vi.fn(function (url: string): FakeStream {
  const stream: FakeStream = { url, onmessage: null, onerror: null, closed: false, close: () => { stream.closed = true; } };
  return stream;
});

describe('computeRegionGeometryWithProgress', () => {
  beforeEach(() => {
    FakeEventSource.mockClear();
    vi.stubGlobal('EventSource', FakeEventSource);
    // The token below is not a JWT, so it reads as expiring; the refresh it
    // asks for answers 401 and the token in hand is sent.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    setAccessToken('the-session-token');
  });

  afterEach(() => {
    setAccessToken(null);
    vi.unstubAllGlobals();
  });

  async function opened(): Promise<FakeStream> {
    await vi.waitFor(() => expect(FakeEventSource).toHaveBeenCalledTimes(1));
    return FakeEventSource.mock.results[0].value as FakeStream;
  }

  it('opens the stream on the API origin, with the flags set and the token in the query', async () => {
    const done = computeRegionGeometryWithProgress(6737, true, () => undefined, true);
    const stream = await opened();

    expect(stream.url).toBe(
      `${API_URL}/api/world-views/regions/6737/geometry/compute-stream?force=true&skipSnapping=true&token=the-session-token`,
    );
    stream.onmessage?.({ data: JSON.stringify({ type: 'complete' }) });
    await expect(done).resolves.toEqual({ type: 'complete' });
    expect(stream.closed).toBe(true);
  });

  it('sends no flag that is not set', async () => {
    void computeRegionGeometryWithProgress(6737, false, () => undefined);
    const stream = await opened();

    expect(new URL(stream.url).search).toBe('?token=the-session-token');
  });
});
