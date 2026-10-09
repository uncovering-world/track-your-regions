/**
 * `RowKind`, on its own so `queueRows.ts` and `feed/rowSpecific.ts` can both name it
 * without importing each other. `queueRows.ts` re-exports it — every other consumer keeps
 * writing `import type { RowKind } from './queueRows'`.
 */

/** Which question a row asks. `waiting` is the three gated kinds, grouped. */
export type RowKind = 'missing' | 'refused' | 'conflicts' | 'sources' | 'waiting' | 'withdrawn' | 'component-items';
