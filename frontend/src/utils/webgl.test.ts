/**
 * The probe behind every map surface's decision to render or not.
 *
 * Each case re-imports the module, because `isWebGLAvailable` caches its answer
 * for the life of the page — a shared module instance would carry the first
 * verdict into the rest of the file and quietly pass whatever came next.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function freshModule() {
  vi.resetModules();
  return import('./webgl');
}

/** Replaces `getContext` for one test; `afterEach` puts the original back. */
function stubGetContext(impl: (id: string) => unknown) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    // The real signature is heavily overloaded; the probe only ever passes an id.
    ((id: string) => impl(id)) as unknown as HTMLCanvasElement['getContext'],
  );
}

describe('isWebGLAvailable', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports unavailable when no context can be created', async () => {
    stubGetContext(() => null);
    const { isWebGLAvailable } = await freshModule();

    expect(isWebGLAvailable()).toBe(false);
  });

  it('reports unavailable when getContext throws instead of returning null', async () => {
    // Hardened and privacy-hardened browsers take this path rather than the one
    // above, and it is the case that would otherwise escape as an exception
    // from inside a render.
    stubGetContext(() => {
      throw new Error('blocked by configuration');
    });
    const { isWebGLAvailable } = await freshModule();

    expect(isWebGLAvailable()).toBe(false);
  });

  it('reports available when a context is returned', async () => {
    stubGetContext((id) => (id === 'webgl2' ? { getExtension: () => null } : null));
    const { isWebGLAvailable } = await freshModule();

    expect(isWebGLAvailable()).toBe(true);
  });

  it('falls back to webgl when webgl2 is unavailable', async () => {
    // MapLibre asks in this order and settles for either, so answering only on
    // webgl2 would refuse to draw a map the library could have drawn.
    stubGetContext((id) => (id === 'webgl' ? { getExtension: () => null } : null));
    const { isWebGLAvailable } = await freshModule();

    expect(isWebGLAvailable()).toBe(true);
  });

  it('releases the probe context instead of holding it for the page', async () => {
    const loseContext = vi.fn();
    stubGetContext((id) =>
      id === 'webgl2' ? { getExtension: () => ({ loseContext }) } : null,
    );
    const { isWebGLAvailable } = await freshModule();

    expect(isWebGLAvailable()).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('stays available when the driver throws from getExtension', async () => {
    // Releasing the probe context is housekeeping, not evidence. A driver that
    // refuses extension lookups still has a working context, so letting that
    // throw reach the verdict would hide a map the browser can draw — the
    // opposite failure to the one this module exists to prevent.
    stubGetContext((id) =>
      id === 'webgl2'
        ? {
            getExtension: () => {
              throw new Error('extensions unavailable');
            },
          }
        : null,
    );
    const { isWebGLAvailable } = await freshModule();

    expect(isWebGLAvailable()).toBe(true);
  });

  it('probes once and reuses the answer', async () => {
    const getContext = vi.fn().mockReturnValue({ getExtension: () => null });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      getContext as unknown as HTMLCanvasElement['getContext'],
    );
    const { isWebGLAvailable } = await freshModule();

    isWebGLAvailable();
    isWebGLAvailable();
    isWebGLAvailable();

    // Three asks, one context: the answer cannot change without a reload, and
    // each probe would otherwise allocate a real GPU resource.
    expect(getContext).toHaveBeenCalledTimes(1);
  });
});
