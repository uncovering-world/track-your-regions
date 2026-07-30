/**
 * Hierarchical matching policy
 *
 * Resolves the import tree by descending it, matching each node among the
 * divisions beneath the division its nearest resolved ancestor matched. For a
 * source whose tree mirrors the division hierarchy — a base-layer mirror above
 * all — this is both more accurate and simpler than the country-based policy,
 * which anchors on country names found in a global index.
 *
 * Two properties matter and neither is incidental (see ADR-0019):
 *
 * **Ancestor context disambiguates.** The base layer shards countries with
 * overseas territories across continents, so there are seven divisions named
 * "France". A global name index cannot choose and correctly refuses to guess.
 * Descending, exactly one France sits under a resolved Europe.
 *
 * **Unresolvable nodes are transparent, not fatal.** A Wikivoyage tree carries
 * grouping nodes ("Benelux", "Southern Germany") that correspond to no single
 * division. Resolution is therefore against the nearest *resolved* ancestor, so
 * a node that matches nothing costs only itself: Benelux resolves to nothing and
 * Belgium is still found among Europe's descendants. Restricting to a resolved
 * parent's direct children would strand the whole subtree — the all-or-nothing
 * failure this policy exists to avoid, reintroduced one level down.
 */

import { pool } from '../../db/index.js';
import type { ImportProgress, MatchSuggestion, MatchUpdate } from './types.js';
import {
  findBestAmongChildren,
  getPath,
  loadGADMData,
  type DivisionEntry,
  type GADMData,
} from './matcherUtils.js';

/** In-memory import tree node. */
interface ImportNode {
  id: number;
  name: string;
  children: ImportNode[];
}

/** Exact-name matches score 700; anything below that is a fuzzy match. */
const EXACT_SCORE = 700;

/**
 * Load the import tree for a world view into memory, returning its roots.
 * Rows are ordered by id so a parent is not guaranteed to precede its children;
 * the two-pass build does not rely on order.
 */
async function loadImportTree(worldViewId: number): Promise<ImportNode[]> {
  const result = await pool.query<{ id: number; name: string; parent_region_id: number | null }>(
    `SELECT id, name, parent_region_id FROM regions WHERE world_view_id = $1 ORDER BY id`,
    [worldViewId],
  );

  const byId = new Map<number, ImportNode>();
  for (const row of result.rows) {
    byId.set(row.id, { id: row.id, name: row.name, children: [] });
  }

  const roots: ImportNode[] = [];
  for (const row of result.rows) {
    const node = byId.get(row.id)!;
    const parent = row.parent_region_id === null ? undefined : byId.get(row.parent_region_id);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Divisions with no parent — the level the tree's roots are matched against. */
function rootDivisions(gadm: GADMData): DivisionEntry[] {
  const roots: DivisionEntry[] = [];
  for (const entry of gadm.divisionsById.values()) {
    if (entry.parentId === null) roots.push(entry);
  }
  return roots;
}

/** Direct children of a division, as entries. */
function childEntries(gadm: GADMData, divisionId: number): DivisionEntry[] {
  const ids = gadm.childrenOf.get(divisionId);
  if (!ids) return [];
  const entries: DivisionEntry[] = [];
  for (const id of ids) {
    const entry = gadm.divisionsById.get(id);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Every division beneath `divisionId`, excluding itself, breadth-first.
 *
 * Used only as the widened candidate pool when a node matches nothing among its
 * ancestor's direct children — the transparent-node case.
 *
 * Breadth-first is not a detail: `findBestAmongChildren` keeps the *first* match
 * within a score tier, so this order decides which of two equally-scoring
 * divisions a node binds.
 *
 * Worth being precise about what it does and does not buy, because the obvious
 * claim is wrong. A node's children are recorded when that node is expanded, so
 * *every* direct child of the anchor lands in the pool before anything deeper —
 * under a stack as much as a queue. What a stack gets wrong is the order *among*
 * deeper candidates: it expands the anchor's last child before its first, so a
 * depth-3 namesake reached through a later branch can beat a depth-2 one, which
 * is not "nearest". The test for this needs namesakes at two different depths
 * under two different branches; a namesake nested under a direct child cannot
 * tell the two traversals apart.
 *
 * The index-based walk keeps it FIFO without the O(n) shift of `Array.shift()`.
 */
function descendantEntries(gadm: GADMData, divisionId: number): DivisionEntry[] {
  const entries: DivisionEntry[] = [];
  const queue = [divisionId];
  for (let head = 0; head < queue.length; head++) {
    for (const id of gadm.childrenOf.get(queue[head]) ?? []) {
      const entry = gadm.divisionsById.get(id);
      if (entry) entries.push(entry);
      queue.push(id);
    }
  }
  return entries;
}

function suggestionFor(entry: DivisionEntry, score: number, gadm: GADMData): MatchSuggestion {
  return {
    divisionId: entry.id,
    name: entry.name,
    path: getPath(entry.id, gadm.pathCache, gadm.divisionsById),
    score,
  };
}

/**
 * Bind a sibling group to candidate divisions, exact matches first.
 *
 * Two passes rather than one because a claimed division cannot be offered twice:
 * with a single pass, a fuzzy match earlier in the group could take the division
 * that a later sibling matches exactly. "Osh" and "Osh (city)" are the shape of
 * that collision — both plausible for each other under a prefix match, and only
 * one assignment of the two is right.
 *
 * Names are matched verbatim: `findBestAmongChildren`'s parenthetical stripping
 * is off here, because a mirror's names *are* division names.
 */
function bindSiblings(
  nodes: ImportNode[],
  candidates: DivisionEntry[],
  claimed: Set<number>,
): Map<number, DivisionEntry> {
  const bound = new Map<number, DivisionEntry>();
  const unbound: ImportNode[] = [];

  for (const node of nodes) {
    const available = candidates.filter(c => !claimed.has(c.id));
    const best = findBestAmongChildren(node.name, available, false);
    if (best && best.score >= EXACT_SCORE) {
      bound.set(node.id, best.entry);
      claimed.add(best.entry.id);
    } else {
      unbound.push(node);
    }
  }

  for (const node of unbound) {
    const available = candidates.filter(c => !claimed.has(c.id));
    const best = findBestAmongChildren(node.name, available, false);
    if (best) {
      bound.set(node.id, best.entry);
      claimed.add(best.entry.id);
    }
  }

  return bound;
}

interface DescentContext {
  gadm: GADMData;
  claimed: Set<number>;
  outcomes: MatchUpdate[];
  progress: ImportProgress;
}

/**
 * Resolve one sibling group against an ancestor's division, then recurse.
 *
 * `anchorId` is the division of the nearest resolved ancestor, or null at the
 * tree's roots (where the candidates are the root divisions). A node that
 * resolves becomes the anchor for its own children; a node that does not passes
 * the anchor it was given straight through — that is the transparency.
 */
function descend(nodes: ImportNode[], anchorId: number | null, ctx: DescentContext): void {
  // Mirrors the country policy's per-node check (matcherCountryPolicy.ts). Without
  // it a cancelled import runs the whole descent and commits every row, while
  // runImport takes its cancelled branch and never advances import_runs to
  // 'reviewing' — leaving a fully matched world view stuck in 'matching'.
  if (nodes.length === 0 || ctx.progress.cancel) return;

  const { gadm, claimed, outcomes } = ctx;
  const direct = anchorId === null ? rootDivisions(gadm) : childEntries(gadm, anchorId);
  const bound = bindSiblings(nodes, direct, claimed);

  // Nodes that matched nothing among the direct children get a second look at
  // the whole subtree — the transparent-ancestor case. At the roots there is no
  // wider pool to widen to.
  const stillUnbound = nodes.filter(n => !bound.has(n.id));
  if (stillUnbound.length > 0 && anchorId !== null) {
    const wider = descendantEntries(gadm, anchorId);
    for (const [nodeId, entry] of bindSiblings(stillUnbound, wider, claimed)) {
      bound.set(nodeId, entry);
    }
  }

  for (const node of nodes) {
    const entry = bound.get(node.id);
    if (entry) {
      outcomes.push({ id: node.id, matchStatus: 'auto_matched', divisionId: entry.id, suggestions: [] });
      ctx.progress.matchedRegions++;
      descend(node.children, entry.id, ctx);
    } else {
      // No division claimed. Offer whatever the anchor's children were as review
      // candidates, then pass the anchor down unchanged so the subtree survives.
      const suggestions = direct.slice(0, 10).map(c => suggestionFor(c, 500, gadm));
      outcomes.push({
        id: node.id,
        matchStatus: suggestions.length > 0 ? 'needs_review' : 'no_candidates',
        suggestions,
      });
      ctx.progress.noCandidates++;
      descend(node.children, anchorId, ctx);
    }
  }
}

/** Write outcomes in one transaction, mirroring the country policy's writer. */
async function writeOutcomes(outcomes: MatchUpdate[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const outcome of outcomes) {
      await client.query(
        `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
        [outcome.matchStatus, outcome.id],
      );
      for (const suggestion of outcome.suggestions) {
        await client.query(
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score)
           VALUES ($1, $2, $3, $4, $5)`,
          [outcome.id, suggestion.divisionId, suggestion.name, suggestion.path, suggestion.score],
        );
      }
      if (outcome.divisionId !== undefined) {
        await client.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [outcome.id, outcome.divisionId],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Match an import tree by descending the division hierarchy alongside it.
 *
 * Same signature and side effects as `matchCountryLevel`: sets
 * `region_import_state.match_status`, inserts `region_match_suggestions` for
 * anything left for review, and inserts `region_members` for what it resolved.
 * Geometry is not computed here — that is a separate pass, as it is for every
 * policy.
 */
export async function matchHierarchical(
  worldViewId: number,
  progress: ImportProgress,
): Promise<void> {
  progress.status = 'matching';
  const startTime = Date.now();

  progress.statusMessage = 'Loading divisions into memory...';
  const gadm = await loadGADMData();

  progress.statusMessage = 'Loading import regions...';
  const roots = await loadImportTree(worldViewId);

  progress.statusMessage = 'Matching by hierarchy...';
  const ctx: DescentContext = { gadm, claimed: new Set<number>(), outcomes: [], progress };
  ctx.progress.matchedRegions = 0;
  ctx.progress.noCandidates = 0;
  descend(roots, null, ctx);

  if (progress.cancel) {
    progress.status = 'cancelled';
    progress.statusMessage = 'Matching cancelled';
    console.log('[WV Matcher/hierarchical] Cancelled before writing; nothing committed.');
    return;
  }

  progress.statusMessage = 'Writing match results...';
  await writeOutcomes(ctx.outcomes);

  // Region-named counters, because that is what this policy resolves. The
  // country-named ones (`countriesMatched`, `totalCountries`,
  // `subdivisionsDrilled`) are deliberately left alone: the import panel gates
  // its "Matching countries: N/M" bar on `totalCountries > 0`, so leaving it at
  // zero hides a progress bar that would otherwise count regions under a
  // country label. See #457.
  progress.totalRegions = ctx.outcomes.length;

  const seconds = ((Date.now() - startTime) / 1000).toFixed(1);
  progress.statusMessage =
    `Hierarchical match complete: ${progress.matchedRegions} matched, `
    + `${progress.noCandidates} unresolved of ${ctx.outcomes.length}. Took ${seconds}s.`;
  console.log(`[WV Matcher/hierarchical] ${progress.statusMessage}`);
}
