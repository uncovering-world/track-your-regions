/**
 * Two labels that name the same thing — the drawing side's copy of the rule the
 * catalogue is folded by.
 *
 * The server refuses a maker list that names one person twice, folded: NFKC,
 * every Unicode dash to the plain one, runs of whitespace to a single space,
 * trimmed, lowercased (`foldLabel`, `backend/src/services/sync/labelFold.ts`).
 * A form that asks a narrower question lets through exactly what the server then
 * refuses — and a Zod refusal reaches the client as `{ error: 'Validation
 * error' }` with the reason in a `details` array no screen reads, which is the
 * red box explaining nothing that `WorkCorrection`'s `refusals()` exists to
 * prevent.
 *
 * It is reachable with an ordinary paste rather than by contrivance: a work
 * names *Vincent van Gogh* and a curator pastes `Vincent  van Gogh` off a
 * wrapped line, or `Jean‐Luc Godard` with U+2010 where the stored name has a
 * hyphen. Compared on case alone, both are new names to the form and repeats to
 * the server.
 *
 * A copy rather than an import, because no module crosses that boundary (#527)
 * — the same arrangement `TRUSTED_IMAGE_DOMAINS` has, and pinned the same way:
 * `labelFold.test.ts` reads the backend's declaration and asserts the two agree,
 * so a change to one that is not made to the other fails rather than drifts.
 */

/** A label reduced to what it names, with its typesetting removed. */
export function foldLabel(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    // Every dash Unicode offers, to the plain one. `‐-―` covers hyphen
    // through horizontal bar; `−` is the minus sign, which sources use too.
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Whether two labels name the same thing. */
export function sameLabel(a: string | null | undefined, b: string | null | undefined): boolean {
  return foldLabel(a) === foldLabel(b);
}
