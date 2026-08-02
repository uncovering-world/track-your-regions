/**
 * Whether this browser can paint a MapLibre map.
 *
 * MapLibre GL draws every map through WebGL — including the surfaces whose
 * tiles are plain raster PNG, so "our tiles are raster" is not a reprieve. When
 * no context can be created its constructor *throws* `Failed to initialize
 * WebGL` (`maplibre-gl@4.7`, `Map._setupPainter`), and the app has no error
 * boundary, so an unguarded map surface takes the React tree down with it
 * rather than degrading.
 *
 * MapLibre removed the `supported()` helper it had in v2, so the probe is ours.
 * It requests the same contexts in the same order the library does, which is
 * what keeps it from answering yes where the library would still fail.
 *
 * ADR-worthy alternative deliberately not taken here: a second, raster
 * renderer. Issue #477 tracks that. Until it exists, callers use this to render
 * an explanation instead of a map.
 */

let cached: boolean | undefined;

/**
 * Cached because the answer cannot change without a page reload — enabling
 * hardware acceleration restarts the GPU process — and because probing is not
 * free: each call would allocate a real context, and eight surfaces ask.
 */
export function isWebGLAvailable(): boolean {
  if (cached === undefined) {
    cached = probeWebGL();
  }
  return cached;
}

function probeWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl: RenderingContext | null =
      canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return false;

    releaseProbeContext(gl);
    return true;
  } catch {
    // Hardened and privacy-focused configurations throw from `getContext`
    // rather than returning null. Either way the map cannot be painted, and
    // the caller needs a boolean, not the distinction.
    return false;
  }
}

/**
 * The probe context is a real GPU resource, so it is handed back rather than
 * held for the life of the page to keep an answer that is already cached.
 *
 * Its own failures are swallowed deliberately: releasing is housekeeping, never
 * evidence. A driver that throws from `getExtension` still has a working
 * context, and letting that reach the verdict would hide a map the browser can
 * perfectly well draw. Worst case the context lives until the canvas is
 * collected, which is what would have happened without this anyway.
 */
function releaseProbeContext(gl: RenderingContext): void {
  try {
    const loseContext = (gl as WebGLRenderingContext)
      .getExtension('WEBGL_lose_context') as { loseContext(): void } | null;
    loseContext?.loseContext();
  } catch {
    // Deliberately ignored — see above.
  }
}
