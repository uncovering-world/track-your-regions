/**
 * How long one statement of a region's geometry computation may run, by the
 * process it runs in (#459, ADR-0123): the one declaration both writers read.
 *
 * A union is made of full-resolution inputs, so its time grows with the
 * region: measured on 2026-10-18, Canada's took 3 min 18 s, Asia's 6 min 15 s
 * and Europe's 9 min 42 s. The dump worker, which runs a world view's
 * computation (ADR-0122), gets three times the slowest. A request the backend
 * answers, the editor's single-region stream, keeps the bound a request can
 * hold, and a region too large for it fails loudly there, pointing to the
 * world view's computation.
 */
export const GEOMETRY_STATEMENT_TIMEOUT_MS = {
  worker: 30 * 60_000,
  request: 5 * 60_000,
} as const;
