/**
 * A keeping build of the OpenStreetMap layer (#1437, ADR-0134): the objects of
 * the planet the catalogue asks about, cut from the planet brought current by
 * its daily diffs, and swapped in whole.
 *
 * The planet is the current one where one is kept (`planetCurrent.ts`),
 * brought forward with the daily diffs since it was last; on a first build it
 * is the weekly planet file, held as a verified local copy
 * (`holdVerifiedCopy`), brought forward the same way, and removed once the
 * current planet replaces it. From the current planet the build:
 * 1. cuts the selected objects with `osmium tags-filter`, which also keeps
 *    the nodes and members they are drawn from (`layerSelection.ts`);
 * 2. cuts every object the catalogue names with `osmium getid -r`, with what
 *    it is drawn from, and merges the two, so a linked object is kept whatever
 *    its tags (decision 3);
 * 3. loads the cut through the flex style (`layer.lua`) into the `_next` copy,
 *    with osm2pgsql's node store in the database and dropped after the load;
 * 4. indexes the copy and swaps it in with the planet's replication timestamp,
 *    which every answer read from the layer carries (decision 5).
 * 5. fills the store of region shapes the world-view match reads from the
 *    objects it kept whole for the items the imports name (`layerShapes.ts`,
 *    ADR-0157).
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
import type { DumpFile, TextReader } from '../catalog.js';
import { fetchText } from '../fetch.js';
import { holdVerifiedCopy, type ReadOptions, type ReadResult } from '../read.js';
import { drawnFile, drawnItems, LAYER_DRAWN, pinnedObjects, selectionFile } from './layerSelection.js';
import { refillRegionShapes } from './layerShapes.js';
import { dropImportProperties, dropNextTable, indexNextTable, MIDDLE_PREFIX, nextTableCount, NEXT_TABLE, swapIn } from './layerTables.js';
import { bringForward, CURRENT_PLANET, dailyState, dropCurrent, firstDiffAfter, readCurrent, type BroughtForward } from './planetCurrent.js';
import { databaseEnv, OSM2PGSQL, OSM2PGSQL_INPUT, OSMIUM, OSMIUM_OUTPUT, runTool, sideBySide } from './tools.js';

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
 * The instant a weekly planet is current to, from its header
 * (`osmosis_replication_timestamp`), or the start of its date where the header
 * names none.
 */
async function weeklyInstant(planet: string, file: DumpFile, signal: AbortSignal): Promise<string> {
  const header = (await runTool(OSMIUM, ['fileinfo', '-g', 'header.option.osmosis_replication_timestamp', planet], { signal })).stdout.trim();
  const instant = header ? new Date(header) : null;
  return instant && !Number.isNaN(instant.getTime()) ? instant.toISOString() : `${file.date}T00:00:00.000Z`;
}

interface Cut {
  cut: string;
  pins: string;
  /** The items the world-view imports name, whose objects the layer keeps whole. */
  items: string[];
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
  const items = await drawnItems();
  await writeFile(selection, selectionFile());
  await writeFile(join(work, 'drawn.txt'), drawnFile());
  await writeFile(join(work, 'drawn-items.txt'), items.length > 0 ? `${items.join('\n')}\n` : '');
  await writeFile(pins, named.length > 0 ? `${named.join('\n')}\n` : '');

  const selected = join(work, 'selected.osm.pbf');
  // Read by osm2pgsql itself where nothing is merged into it.
  const tagsFilter = ['tags-filter', planet, '-e', selection, '-o', selected, named.length === 0 ? OSM2PGSQL_INPUT : OSMIUM_OUTPUT, '--overwrite'];
  if (named.length === 0) {
    options.onPhase('Cutting the selected objects from the planet...');
    await runTool(OSMIUM, tagsFilter, { signal });
    return { cut: selected, pins, items, pinned: 0, gone: 0 };
  }

  const linked = join(work, 'linked.osm.pbf');
  const cut = join(work, 'layer.osm.pbf');
  // The two cuts read the planet each, independently: run side by side, they
  // cost one read's time rather than two (10.8 and 6 minutes one after the
  // other on the first build). Exit 1 is also osmium's answer to an error
  // reading the data: it is taken as "some objects are gone" only where
  // osmium says so.
  options.onPhase(`Cutting the selected objects and the ${named.length.toLocaleString('en')} objects the catalogue names from the planet...`);
  const [, found] = await sideBySide(signal, [
    (each) => runTool(OSMIUM, tagsFilter, { signal: each }),
    (each) => runTool(OSMIUM, ['getid', '-r', '--verbose-ids', planet, '-i', pins, '-o', linked, OSMIUM_OUTPUT, '--overwrite'], { signal: each, exitCodes: [0, 1] }),
  ]);
  const gone = found.code === 0 ? { count: 0, ids: [] } : goneObjects(found.stderr);
  if (!gone) throw new Error(`osmium getid failed (1): ${found.stderr.slice(-2000).trim()}`);
  if (gone.count > 0) {
    const listed = gone.ids.slice(0, GONE_NAMED).join(', ') + (gone.ids.length > GONE_NAMED ? ', ...' : '');
    const which = listed ? ': ' + listed : '';
    options.onNote?.(`${gone.count.toLocaleString('en')} objects the catalogue names are no longer in the planet${which}`);
  }
  await runTool(OSMIUM, ['merge', selected, linked, '-o', cut, OSM2PGSQL_INPUT, '--overwrite'], { signal });
  return { cut, pins, items, pinned: named.length, gone: gone.count };
}

/** Load the cut through the flex style into the `_next` copy. */
async function loadLayer(cut: string, work: string, pins: string, signal: AbortSignal): Promise<void> {
  await dropNextTable();
  await runTool(OSM2PGSQL, [
    '--create', '--output=flex', `--style=${STYLE}`, '--slim', '--drop', `--cache=${NODE_CACHE_MB}`,
    '--middle-schema=workbench', `--prefix=${MIDDLE_PREFIX}`, cut,
  ], {
    signal,
    env: {
      ...databaseEnv(), OSM_LAYER_TABLE: NEXT_TABLE, OSM_LAYER_SELECTION: join(work, 'selection.txt'),
      OSM_LAYER_DRAWN: join(work, 'drawn.txt'), OSM_LAYER_DRAWN_ITEMS: join(work, 'drawn-items.txt'), OSM_LAYER_PINS: pins,
    },
  });
  await dropImportProperties();
}

/** What the layer is cut from: the current planet, and the weekly planet held for it on a first build. */
type Planet = BroughtForward & { held: ReadResult | null };

/**
 * Start the current planet again from the weekly planet `file`: held as a
 * verified local copy, brought forward with every daily diff since the
 * instant its header names, and removed once the current planet replaces it.
 * A current planet kept before is dropped once the weekly one is verified, so
 * a download that fails leaves it to be brought forward.
 */
async function planetFromWeekly(file: DumpFile, dir: string, work: string, options: LayerBuildOptions): Promise<Planet> {
  const { signal } = options;
  const read: TextReader = url => fetchText(url, signal);
  const held = await holdVerifiedCopy(file, options);
  await dropCurrent(dir);
  const newest = await dailyState(read);
  const first = await firstDiffAfter(await weeklyInstant(held.path, file, signal), newest, read);
  const current = await bringForward(held.path, first, file.fileName, newest, { dir, work, signal, onPhase: options.onPhase });
  await rm(held.path, { force: true });
  options.onNote?.(`removed ${file.fileName}: the current planet, brought forward to daily diff ${current.state.sequence}, replaces it`);
  return { ...current, held };
}

/** The current planet kept under `dir`, brought forward with the daily diffs since its state. */
async function planetKept(dir: string, work: string, options: LayerBuildOptions): Promise<Planet> {
  const { signal } = options;
  const kept = await readCurrent(dir);
  if (!kept) throw new Error('No current planet is kept to bring forward: build the layer from a weekly planet first');
  const newest = await dailyState(url => fetchText(url, signal));
  const current = await bringForward(join(dir, CURRENT_PLANET), kept.sequence + 1, kept.base, newest, { dir, work, signal, onPhase: options.onPhase });
  return { ...current, held: null };
}

/** Whether a current planet is kept under `DUMPS_DIR`, which a keeping build from the newest then brings forward. */
export async function hasCurrentPlanet(): Promise<boolean> {
  const dir = process.env.DUMPS_DIR?.trim();
  return dir ? (await readCurrent(dir)) !== null : false;
}

type LayerResult = { bytes: number; lines: number; checksumActual: string | null; summary?: string };

/**
 * Fill the store of region shapes from the layer just swapped in, and say
 * what it holds. The layer stands whether or not this succeeds: a store left
 * as it was is a note on the build, and the next build fills it again.
 */
async function regionShapesFrom(items: string[], options: LayerBuildOptions): Promise<string> {
  options.onPhase('Keeping the shapes of the regions the world-view imports name...');
  try {
    const { held } = await refillRegionShapes(items);
    return `; ${held.toLocaleString('en')} of the ${items.length.toLocaleString('en')} items the world-view imports name have a region shape`;
  } catch (error) {
    options.onNote?.(`the region shapes were not refreshed from this layer, and the store keeps the last build's: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
}

/** Cut the layer from the planet `planetOf` makes ready in the cut's directory, and swap it in. */
async function cutAndSwap(
  options: LayerBuildOptions, planetOf: (dir: string, work: string) => Promise<Planet>,
): Promise<LayerResult> {
  if (options.trial) throw new Error('The OpenStreetMap layer has no trial build: it is cut from the whole planet');
  const { signal } = options;
  if (!options.dumpsDir) throw new Error('The OpenStreetMap layer is cut from a local copy of the planet (DUMPS_DIR is not set)');
  // A stopped build's cut goes before the planet is held, so a new planet's
  // download never waits on disk that cut still holds.
  const work = join(options.dumpsDir, CUT_DIRECTORY);
  await rm(work, { recursive: true, force: true });
  await mkdir(work);
  try {
    const planet = await planetOf(options.dumpsDir, work);
    const current = planet.state.timestamp;
    const { cut, pins, items, pinned, gone } = await cutLayer(planet.path, work, options);
    options.onPhase('Loading the layer into the database...');
    await loadLayer(cut, work, pins, signal);
    const objects = await nextTableCount();
    if (objects === 0) throw new Error('The cut kept no object, so the layer in place stays');
    options.onPhase('Indexing the layer...');
    await indexNextTable(signal);
    // The layer's date is the day it is current to, so a newer weekly planet
    // is not offered as newer than a layer already brought past it.
    await swapIn({
      buildId: options.buildId, planetFile: planet.state.base, dumpDate: current.slice(0, 10), replicatedAt: current, objects, pinned, pinnedGone: gone,
      drawn: LAYER_DRAWN,
    }, signal);
    const shapesSaid = await regionShapesFrom(items, options);
    const goneSaid = gone > 0 ? ` (${gone.toLocaleString('en')} of them no longer in the planet)` : '';
    return {
      bytes: planet.held?.bytes ?? planet.bytes, lines: 0, checksumActual: planet.held?.checksumActual ?? null,
      summary: `kept ${objects.toLocaleString('en')} OpenStreetMap objects from ${planet.state.base} brought forward with `
        + `${planet.applied} daily diffs to diff ${planet.state.sequence}, current to ${current}, `
        + `with the ${pinned.toLocaleString('en')} objects the catalogue names cut in whatever their tags${goneSaid}${shapesSaid}`,
    };
  } catch (error) {
    await dropNextTable().catch(() => undefined);
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Start the current planet again from the weekly planet `file`, cut the layer from it, and swap it in. */
export function buildLayer(file: DumpFile, options: LayerBuildOptions): Promise<LayerResult> {
  return cutAndSwap(options, (dir, work) => planetFromWeekly(file, dir, work, options));
}

/** Bring the kept current planet forward with the daily diffs since, cut the layer from it, and swap it in; reads no weekly planet. */
export function updateLayer(options: LayerBuildOptions): Promise<LayerResult> {
  return cutAndSwap(options, (dir, work) => planetKept(dir, work, options));
}
