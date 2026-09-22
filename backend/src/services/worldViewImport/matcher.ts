/**
 * WorldView Import Matcher — policy barrel
 *
 * The matcher is a set of interchangeable policies over one shared core. This
 * file names the public surface; each policy owns its own module, and the name
 * and GADM machinery they share lives in `matcherUtils.ts`.
 *
 * | Policy | Module | For |
 * |---|---|---|
 * | `country-based` (default) | `matcherCountryPolicy.ts` | Wikivoyage and file imports, whose nodes may be groups of divisions |
 * | `hierarchical` | `matcherHierarchicalPolicy.ts` | sources whose tree mirrors the division hierarchy, e.g. a base-layer mirror |
 * | legacy leaf | `matcherLeafPolicy.ts` | **nothing calls it** — see below |
 *
 * The shared name-matching helpers live in `matcherUtils.ts` and each policy
 * imports them: a private copy diverges from the exported one. See ADR-0019.
 *
 * `matchLeafRegions` has no caller — not here, not on main. It is carried through
 * the split rather than deleted because "is the legacy leaf matcher still wanted"
 * is a different question from the duplication this change removed, and `knip`
 * as the gate runs `files,dependencies,unlisted` rather than `exports`, so it
 * never surfaced. Tracked as #458.
 */

export { matchCountryLevel } from './matcherCountryPolicy.js';
export { matchHierarchical } from './matcherHierarchicalPolicy.js';
export { matchLeafRegions } from './matcherLeafPolicy.js';
