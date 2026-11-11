/**
 * A large value written to a file and read back in slices (#2424): the
 * surroundings pool is about 270 MB, and one `v8.serialize` of it holds the
 * backend's event loop for seconds, one `v8.deserialize` for longer. Every
 * Map of more than a slice's entries is written as frames of that many
 * entries, the turn handed back between frames, as `surroundingsPool.ts`
 * slices its arithmetic; the rest of the value is one last frame, with a mark
 * where each such Map stood.
 *
 * A frame is its length (four bytes) and its `v8.serialize` bytes. A file
 * whose last frame is not the value's rest is refused, so a write cut short
 * is never read as a smaller value.
 */
import { open, readFile } from 'node:fs/promises';
import { deserialize, serialize } from 'node:v8';

/** Entries per frame: a Map of the pool's rows reads 5,000 of them in tens of milliseconds. */
const SLICE_ENTRIES = 5000;
const MARK = '__slicedMap';

type Frame = { map: number; entries: [unknown, unknown][] } | { rest: unknown; maps: number };

const nextTurn = () => new Promise<void>((done) => { setImmediate(done); });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * The value with every Map of more than `slice` entries put aside in `maps` and
 * a mark in its place; a Map held in two places is put aside once, both marks
 * naming it (`seen`), so it is written once and read back as one Map.
 */
function setAside(value: unknown, maps: Map<unknown, unknown>[], slice: number, seen = new Map<Map<unknown, unknown>, number>()): unknown {
  if (value instanceof Map) {
    if (value.size > slice) {
      let id = seen.get(value);
      if (id === undefined) {
        id = maps.push(value) - 1;
        seen.set(value, id);
      }
      return { [MARK]: id };
    }
    return new Map([...value].map(([key, entry]) => [key, setAside(entry, maps, slice, seen)]));
  }
  if (Array.isArray(value)) return value.map((entry) => setAside(entry, maps, slice, seen));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, setAside(entry, maps, slice, seen)]));
  }
  return value;
}

/** The value with each mark replaced by the Map it stands for. */
function putBack(value: unknown, maps: readonly Map<unknown, unknown>[]): unknown {
  if (value instanceof Map) return new Map([...value].map(([key, entry]) => [key, putBack(entry, maps)]));
  if (Array.isArray(value)) return value.map((entry) => putBack(entry, maps));
  if (isPlainObject(value)) {
    const mark = value[MARK];
    if (typeof mark === 'number' && Object.keys(value).length === 1) {
      const map = maps[mark];
      if (!map) throw new Error(`the file names Map ${mark}, which it does not hold`);
      return map;
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, putBack(entry, maps)]));
  }
  return value;
}

/** Write the value to the file in frames, handing the turn back between them. */
export async function writeSliced(file: string, value: unknown, slice = SLICE_ENTRIES): Promise<void> {
  const maps: Map<unknown, unknown>[] = [];
  const rest = setAside(value, maps, slice);
  const handle = await open(file, 'w');
  try {
    const write = async (frame: Frame) => {
      const bytes = serialize(frame);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(bytes.length);
      await handle.write(length);
      await handle.write(bytes);
      await nextTurn();
    };
    for (const [id, map] of maps.entries()) {
      let entries: [unknown, unknown][] = [];
      for (const entry of map) {
        entries.push(entry);
        if (entries.length === slice) {
          await write({ map: id, entries });
          entries = [];
        }
      }
      if (entries.length > 0) await write({ map: id, entries });
    }
    await write({ rest, maps: maps.length });
  } finally {
    await handle.close();
  }
}

/** Read a value written by `writeSliced`, frame by frame, handing the turn back between them. */
export async function readSliced(file: string): Promise<unknown> {
  const bytes = await readFile(file);
  const maps: Map<unknown, unknown>[] = [];
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 4 + length;
    if (end > bytes.length) break;
    const frame = deserialize(bytes.subarray(offset + 4, end)) as Frame;
    offset = end;
    await nextTurn();
    if ('rest' in frame) {
      if (offset !== bytes.length || frame.maps !== maps.length) break;
      return putBack(frame.rest, maps);
    }
    maps[frame.map] ??= new Map();
    for (const [key, entry] of frame.entries) maps[frame.map].set(key, entry);
  }
  throw new Error('the file ends before the value it holds does');
}
