/**
 * WorldView Importer
 *
 * Creates a WorldView + region hierarchy from an import JSON tree.
 * Uses relational tables (region_import_state, region_map_images) instead of JSONB metadata.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../db/index.js';
import type { ImportTreeNode, ImportProgress } from './types.js';

/** Count total nodes in a tree (for progress tracking) */
function countNodes(node: ImportTreeNode): number {
  let count = 1;
  for (const child of node.children) {
    count += countNodes(child);
  }
  return count;
}

/** Count leaf nodes (no children) */
function countLeaves(node: ImportTreeNode): number {
  if (node.children.length === 0) return 1;
  let count = 0;
  for (const child of node.children) {
    count += countLeaves(child);
  }
  return count;
}

/** Options for importTree controlling source metadata */
export interface ImportTreeOptions {
  sourceType?: string;   // default: 'imported'
  source?: string;       // default: 'File upload'
  description?: string;  // default: auto-generated from region count
}

/**
 * Import a JSON tree into a new WorldView.
 *
 * Creates:
 * - A new world_view with the specified source_type
 * - An import_runs record to track the import
 * - Regions for every node in the tree (hierarchical via parent_region_id)
 * - region_import_state rows with sourceUrl and regionMapUrl
 * - region_map_images rows for map image candidates
 *
 * Skips the root "World" node — its children become root regions.
 */
export async function importTree(
  tree: ImportTreeNode,
  worldViewName: string,
  progress: ImportProgress,
  options: ImportTreeOptions = {},
): Promise<number> {
  const sourceType = options.sourceType ?? 'imported';
  const source = options.source ?? 'File upload';
  // Count totals (subtract 1 for the skipped root)
  progress.totalRegions = countNodes(tree) - 1;
  progress.statusMessage = `Creating WorldView with ${progress.totalRegions} regions...`;

  const leafCount = countLeaves(tree);
  console.log(`[WV Importer] Tree stats: ${progress.totalRegions} total regions, ${leafCount} leaves, ${tree.children.length} root children`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create the WorldView
    const description = options.description ??
      `Imported region hierarchy (${progress.totalRegions} regions)`;
    const wvResult = await client.query(
      `INSERT INTO world_views (name, source, source_type, description)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [worldViewName, source, sourceType, description],
    );
    const worldViewId = wvResult.rows[0].id as number;
    progress.worldViewId = worldViewId;
    console.log(`[WV Importer] Created WorldView id=${worldViewId}, name="${worldViewName}"`);

    // Create import run record
    const importRunResult = await client.query(
      `INSERT INTO import_runs (world_view_id, source_type, status)
       VALUES ($1, $2, 'running') RETURNING id`,
      [worldViewId, sourceType],
    );
    const importRunId = importRunResult.rows[0].id as number;
    console.log(`[WV Importer] Created import_run id=${importRunId}`);

    // Walk tree recursively, creating regions
    // Skip root node — its children become root-level regions
    for (const child of tree.children) {
      if (progress.cancel) {
        await client.query('ROLLBACK');
        progress.status = 'cancelled';
        progress.statusMessage = 'Import cancelled';
        return worldViewId;
      }
      await insertRegion(client, child, worldViewId, null, importRunId, progress);
    }

    // Update import run status (matching will be performed later; do not mark as completed yet)
    await client.query(
      `UPDATE import_runs SET status = 'matching',
       stats = $2::jsonb WHERE id = $1`,
      [importRunId, JSON.stringify({ totalRegions: progress.createdRegions, leaves: leafCount })],
    );

    await client.query('COMMIT');
    console.log(`[WV Importer] Transaction committed: ${progress.createdRegions} regions`);
    return worldViewId;
  } catch (err) {
    console.error(`[WV Importer] Transaction rolled back:`, err);
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function insertRegion(
  client: PoolClient,
  node: ImportTreeNode,
  worldViewId: number,
  parentRegionId: number | null,
  importRunId: number,
  progress: ImportProgress,
): Promise<void> {
  if (progress.cancel) return;

  // Insert region (no metadata JSONB needed)
  const result = await client.query(
    `INSERT INTO regions (world_view_id, name, parent_region_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [worldViewId, node.name, parentRegionId],
  );
  const regionId = result.rows[0].id as number;

  const sourceUrl = node.sourceUrl ?? null;

  // Insert region_import_state
  await client.query(
    `INSERT INTO region_import_state (region_id, import_run_id, source_url, source_external_id, region_map_url)
     VALUES ($1, $2, $3, $4, $5)`,
    [regionId, importRunId, sourceUrl, node.wikidataId || null, node.regionMapUrl || null],
  );

  // Insert map image candidates
  if (node.mapImageCandidates?.length) {
    for (const imageUrl of node.mapImageCandidates) {
      await client.query(
        `INSERT INTO region_map_images (region_id, image_url) VALUES ($1, $2)`,
        [regionId, imageUrl],
      );
    }
  }

  progress.createdRegions++;
  if (progress.createdRegions % 500 === 0) {
    console.log(`[WV Importer] Progress: ${progress.createdRegions}/${progress.totalRegions} regions created`);
  }
  if (progress.createdRegions % 100 === 0) {
    progress.statusMessage = `Creating regions... ${progress.createdRegions}/${progress.totalRegions}`;
  }

  // Recurse into children
  for (const child of node.children) {
    if (progress.cancel) return;
    await insertRegion(client, child, worldViewId, regionId, importRunId, progress);
  }
}
