/**
 * Base Layer Importer
 *
 * Reads the administrative base layer (`administrative_divisions`) down to a
 * chosen depth and shapes it as an import tree — one node per division.
 *
 * The base layer is whatever provider currently populates that table. Nothing
 * here names one: the shape comes from `parent_id`, and the provider label is
 * passed in by the caller and stored as data.
 *
 * The tree carries names and hierarchy and nothing else. Tagging each node with
 * the division it was read from would let the importer assert the mapping the
 * matcher is supposed to resolve, and resolving it honestly is the point: this
 * import is how the generic pipeline gets exercised by a second source.
 */

import { pool } from '../../db/index.js';
import type { ImportTreeNode } from './types.js';

export interface BaseLayerTreeOptions {
  /**
   * Deepest division level to include, 0-indexed from the roots (always
   * present at depth 0 regardless of this value). The import endpoint
   * restricts this to 1-3 (`baseLayerImportBodySchema`); nothing below that
   * floor reaches this function in practice.
   */
  maxDepth: number;
}

interface DivisionRow {
  id: number;
  name: string;
  parent_id: number | null;
  depth: number;
}

/**
 * Read the base layer down to `maxDepth` and shape it as an import tree under a
 * synthetic `World` root (importTree skips the root and promotes its children).
 */
export async function buildBaseLayerTree(options: BaseLayerTreeOptions): Promise<ImportTreeNode> {
  const result = await pool.query<DivisionRow>(`
    WITH RECURSIVE tree AS (
      SELECT id, name, parent_id, 0 AS depth
      FROM administrative_divisions
      WHERE parent_id IS NULL
      UNION ALL
      SELECT d.id, d.name, d.parent_id, t.depth + 1
      FROM administrative_divisions d
      JOIN tree t ON d.parent_id = t.id
      WHERE t.depth < $1
    )
    SELECT id, name, parent_id, depth FROM tree ORDER BY depth, name
  `, [options.maxDepth]);

  const root: ImportTreeNode = { name: 'World', children: [] };
  // Keyed by division id only to reassemble the hierarchy here; the id is a
  // local detail and never reaches the emitted nodes.
  const nodes = new Map<number, ImportTreeNode>();

  for (const row of result.rows) {
    nodes.set(row.id, { name: row.name, children: [] });
  }

  // Rows are depth-ordered, so a parent is always in the map before its children.
  for (const row of result.rows) {
    const node = nodes.get(row.id)!;
    if (row.parent_id === null) {
      root.children.push(node);
      continue;
    }
    const parent = nodes.get(row.parent_id);
    if (!parent) {
      throw new Error(`Base layer division ${row.id} references parent ${row.parent_id}, which is not in the tree`);
    }
    parent.children.push(node);
  }

  console.log(`[Base Layer Import] Built tree: ${result.rows.length} divisions, depth <= ${options.maxDepth}`);
  return root;
}
