import { lazy, type ComponentType } from 'react';

/**
 * A screen or dialog's chunk that did not arrive (#643).
 *
 * Its own class so that `ChunkBoundary` can tell it from a render error: a
 * chunk goes missing when a deployment replaced the hashed file names the open
 * tab still asks for, or when the network drops the request, and a reload
 * answers both — which is not true of a bug inside the component.
 */
export class ChunkLoadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'ChunkLoadError';
  }
}

/**
 * `React.lazy` whose failed import rejects with a `ChunkLoadError`. Mount what
 * it returns inside a `ChunkBoundary`, which is where that error is caught.
 */
// The constraint is React.lazy's own, which the returned component has to
// satisfy. Neither `ComponentType<never>` (a class component's static
// `getDerivedStateFromProps` makes it no subtype of `ComponentType<any>`) nor
// a `ComponentType<P>` inferred from the call (`.then(m => ({ default: … }))`
// leaves P as `never`) typechecks at the call sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors React.lazy's `T extends ComponentType<any>`
export function lazyChunk<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() => load().catch((err: unknown) => {
    throw new ChunkLoadError(err);
  }));
}
