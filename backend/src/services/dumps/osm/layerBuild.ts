/**
 * A keeping build of the OpenStreetMap layer (#1437, ADR-0134): the objects of
 * the planet the catalogue asks about, cut from the weekly planet file and
 * swapped in whole.
 *
 * The planet is held as a verified local copy (`holdVerifiedCopy`), never read
 * by lines. From it the build:
 * 1. cuts the selected objects with `osmium tags-filter`, which also keeps
 *    the nodes and members they are drawn from (`layerSelection.ts`);
 * 2. cuts every object the catalogue names with `osmium getid -r`, with what
 *    it is drawn from, and merges the two, so a linked object is kept whatever
 *    its tags (decision 3);
 * 3. loads the cut through the flex style (`layer.lua`) into the `_next` copy,
 *    with osm2pgsql's node store in the database and dropped after the load;
 * 4. indexes the copy and swaps it in with the planet's replication timestamp,
 *    which every answer read from the layer carries (decision 5).
 *
 * An object the catalogue names may since have been deleted from OSM or
 * redrawn under another id. `osmium getid` then exits 1 and names it; the
 * build goes on, and records how many are gone and which, since a place that
 * links an object the planet no longer holds is something the catalogue
 * should hear about.
 *
 * The cut's files live in a directory of their own beside the planet, under
 * a fixed name: the build empties it when it starts, before the planet is
 * held, so a cut that a build stopped by the worker's restart left behind
 * never takes the disk a new planet's download needs; and it removes the
 * directory when it ends, whatever the end. A failure or a cancel drops the copy and
 * leaves the layer in place.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DumpFile } from '../catalog.js';
import { holdVerifiedCopy, type ReadOptions } from '../read.js';
import { pinnedObjects, selectionFile } from './layerSelection.js';
import { dropImportProperties, dropNextTable, indexNextTable, MIDDLE_PREFIX, nextTableCount, NEXT_TABLE, swapIn } from './layerTables.js';
import { databaseEnv, OSM2PGSQL, OSMIUM, runTool } from './tools.js';

export type LayerBuildOptions = ReadOptions & {
  buildId: number; onPhase: (message: string) => void; trial?: boolean;
  onMeasure?: (read: number, total: number) => void;
};

const STYLE = fileURLToPath(new URL('./layer.lua', import.meta.url));

/** The megabytes of node locations osm2pgsql keeps in memory while it loads; the rest go to its node table. */
const NODE_CACHE_MB = '4000';

/** The cut's directory under `DUMPS_DIR`: one build runs at a time, so one name serves. */
const CUT_DIRECTORY = 'osm-layer-cut';

/** How many of the gone objects' ids a build's note names. */
const GONE_NAMED = 20;

/**
 * The objects the catalogue names that `osmium getid` did not find, from what
 * it wrote with `--verbose-ids`: how many it says it did not find, and their
 * ids as it lists them (`n999`).
 */
export function goneObjects(stderr: string): { count: number; ids: string[] } | null {
  const count = /Did not find (\d+) object\(s\)/.exec(stderr);
  if (!count) return null;
  const ids: string[] = [];
  for (const [, kind, list] of stderr.matchAll(/^Missing (node|way|relation) IDs: ?(.*)$/gm)) {
    for (const id of list.trim().split(/\s+/).filter(Boolean)) ids.push(`${kind[0]}${id}`);
  }
  return { count: Number(count[1]), ids };
}

/**
 * The instant the planet is current to, from its header
 * (`osmosis_replication_timestamp`), or the start of its date where the header
 * names none.
 */
async function replicatedAt(planet: string, file: DumpFile, signal: AbortSignal): Promise<string> {
  const header = (await runTool(OSMIUM, ['fileinfo', '-g', 'header.option.osmosis_replication_timestamp', planet], { signal })).stdout.trim();
  const instant = header ? new Date(header) : null;
  return instant && !Number.isNaN(instant.getTime()) ? instant.toISOString() : `${file.date}T00:00:00.000Z`;
}

interface Cut {
  cut: string;
  pins: string;
  /** How many objects the catalogue names, and how many of them the planet no longer holds. */
  pinned: number;
  gone: number;
}

/** Cut the layer's objects from `planet` into `work`. */
async function cutLayer(planet: string, work: string, options: LayerBuildOptions): Promise<Cut> {
  const { signal } = options;
  const selection = join(work, 'selection.txt');
  const pins = join(work, 'pins.txt');
  const named = await pinnedObjects();
  await writeFile(selection, selectionFile());
  await writeFile(pins, named.length > 0 ? `${named.join('\n')}\n` : '');

  const selected = join(work, 'selected.osm.pbf');
  options.onPhase('Cutting the selected objects from the planet...');
  await runTool(OSMIUM, ['tags-filter', planet, '-e', selection, '-o', selected, '--overwrite'], { signal });
  if (named.length === 0) return { cut: selected, pins, pinned: 0, gone: 0 };

  const linked = join(work, 'linked.osm.pbf');
  const cut = join(work, 'layer.osm.pbf');
  options.onPhase(`Cutting the ${named.length.toLocaleString('en')} objects the catalogue names...`);
  // Exit 1 is also osmium's answer to an error reading the data: it is taken
  // as "some objects are gone" only where osmium says so.
  const found = await runTool(OSMIUM, ['getid', '-r', '--verbose-ids', planet, '-i', pins, '-o', linked, '--overwrite'], { signal, exitCodes: [0, 1] });
  const gone = found.code === 0 ? { count: 0, ids: [] } : goneObjects(found.stderr);
  if (!gone) throw new Error(`osmium getid failed (1): ${found.stderr.slice(-2000).trim()}`);
  if (gone.count > 0) {
    const listed = gone.ids.slice(0, GONE_NAMED).join(', ') + (gone.ids.length > GONE_NAMED ? ', ...' : '');
    const which = listed ? ': ' + listed : '';
    options.onNote?.(`${gone.count.toLocaleString('en')} objects the catalogue names are no longer in the planet${which}`);
  }
  await runTool(OSMIUM, ['merge', selected, linked, '-o', cut, '--overwrite'], { signal });
  return { cut, pins, pinned: named.length, gone: gone.count };
}

/** Load the cut through the flex style into the `_next` copy. */
async function loadLayer(cut: string, selection: string, pins: string, signal: AbortSignal): Promise<void> {
  await dropNextTable();
  await runTool(OSM2PGSQL, [
    '--create', '--output=flex', `--style=${STYLE}`, '--slim', '--drop', `--cache=${NODE_CACHE_MB}`,
    '--middle-schema=workbench', `--prefix=${MIDDLE_PREFIX}`, cut,
  ], {
    signal,
    env: { ...databaseEnv(), OSM_LAYER_TABLE: NEXT_TABLE, OSM_LAYER_SELECTION: selection, OSM_LAYER_PINS: pins },
  });
  await dropImportProperties();
}

/** Cut the layer from the planet `file`, and swap it in. */
export async function buildLayer(file: DumpFile, options: LayerBuildOptions): Promise<{ bytes: number; lines: number; checksumActual: string | null; summary?: string }> {
  if (options.trial) throw new Error('The OpenStreetMap layer has no trial build: it is cut from the whole planet');
  const { signal } = options;
  // A stopped build's cut goes before the planet is held, so a new planet's
  // download never waits on disk that cut still holds. Without DUMPS_DIR
  // there is no cut, and holdVerifiedCopy says so.
  const work = options.dumpsDir ? join(options.dumpsDir, CUT_DIRECTORY) : null;
  if (work) await rm(work, { recursive: true, force: true });
  const held = await holdVerifiedCopy(file, options);
  if (!work) throw new Error('The OpenStreetMap layer is cut from a local copy (DUMPS_DIR is not set)');
  await mkdir(work);
  try {
    const { cut, pins, pinned, gone } = await cutLayer(held.path, work, options);
    const current = await replicatedAt(held.path, file, signal);
    options.onPhase('Loading the layer into the database...');
    await loadLayer(cut, join(work, 'selection.txt'), pins, signal);
    const objects = await nextTableCount();
    if (objects === 0) throw new Error('The cut kept no object, so the layer in place stays');
    options.onPhase('Indexing the layer...');
    await indexNextTable(signal);
    await swapIn({ buildId: options.buildId, planetFile: file.fileName, dumpDate: file.date, replicatedAt: current, objects, pinned, pinnedGone: gone }, signal);
    const goneSaid = gone > 0 ? ` (${gone.toLocaleString('en')} of them no longer in the planet)` : '';
    return {
      bytes: held.bytes, lines: held.lines, checksumActual: held.checksumActual,
      summary: `kept ${objects.toLocaleString('en')} OpenStreetMap objects from ${file.fileName}, current to ${current}, `
        + `with the ${pinned.toLocaleString('en')} objects the catalogue names cut in whatever their tags${goneSaid}`,
    };
  } catch (error) {
    await dropNextTable().catch(() => undefined);
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
