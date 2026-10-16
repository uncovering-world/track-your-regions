/**
 * What the latency probe (scripts/perf-api.mjs) says about a run besides its
 * numbers: the precondition it checks before measuring, and why each endpoint
 * that failed did, how it reads its arguments and how it ranks its samples.
 * Kept apart from the probe, which measures as soon as it is loaded, so a spec
 * can import it; a bad argument is thrown here and the probe turns it into its
 * exit.
 */

/**
 * The root regions of a world view that have no geometry, from the answer of
 * `GET /api/world-views/:id/regions/root`. `focusBbox` is the region's own
 * column, and update_region_focus_data() clears it exactly when the region has
 * neither a geometry nor a hull - which is the state ADR-0035 leaves a derived
 * ancestor in when a descendant's geometry is written, until the world view's
 * next run rebuilds it. A root drawn as a hull keeps its hull, and with it its
 * frame, when its geometry is cleared, so the read cannot tell that one; its
 * tiles still fail, as an empty tile, without a region to name.
 */
export function rootsWithoutGeometry(roots) {
  return roots.filter((root) => root.focusBbox == null).map(({ id, name }) => ({ id, name }));
}

/**
 * The sentence the probe fails with when a root region has no geometry. A
 * root-regions tile that region reaches then draws less of the world than the
 * baseline did, so its timing is not the one docs/tech/performance.md holds,
 * and a tile no other root reaches answers 204.
 */
export function rootsWithoutGeometrySentence(worldView, roots) {
  const named = roots.map(({ id, name }) => `${name} (${id})`).join(', ');
  return `World view ${worldView} has root regions with no geometry: ${named}. `
    + 'A derived region loses its geometry when a descendant\'s changes and gets it back on the world view\'s next run (ADR-0035); '
    + 'until then a root-regions tile they reach draws less than the baseline measured, and a tile only they reach answers 204. '
    + 'The rows above were measured anyway.';
}

/** Why an endpoint failed, from the first status that went wrong (0: no answer at all). */
export function failureReason(status) {
  if (status === 0) return 'no answer (timed out or refused)';
  if (status === 204) return 'an empty tile (204)';
  return `answered ${status}`;
}

/** One line per endpoint that failed, naming its reason. */
export function failureLines(results) {
  return results
    .filter((result) => result.failures > 0)
    .map((result) => `  ${result.name}: ${failureReason(result.status)}`);
}

const OPTIONS_WITH_VALUE = new Set(['api', 'martin', 'world-view', 'region', 'runs']);

/** Errors name the option, never what was typed after it. */
export function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    const key = arg.startsWith('--') ? arg.slice(2) : '';
    if (!OPTIONS_WITH_VALUE.has(key)) {
      throw new Error(`Unexpected argument at position ${i + 1}; options are --api, --martin, --world-view, --region, --runs, --json`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${key} needs a value`);
    }
    parsed[key] = value;
    i += 1;
  }
  return parsed;
}

/**
 * Only the origin is kept: a path, query or credentials typed into --api
 * would otherwise be echoed into the output. The error message names the
 * flag and not the value, for the same reason.
 */
export function originOf(value, flag) {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`${flag} must be a URL`);
  }
}

/**
 * Linear interpolation between ranks (R-7, what spreadsheets and NumPy
 * compute), so that at thirty samples p95 sits between the second-highest
 * and the highest rather than being the maximum under another name - which
 * is what nearest-rank gives for every sample count below twenty.
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) {
    return null;
  }
  const position = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
