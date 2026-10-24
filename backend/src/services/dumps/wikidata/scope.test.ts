import { describe, expect, it } from 'vitest';
import { ScopeCollector } from './scope.js';
import { at, dumpLine, item } from './dumpLineFixture.js';

// Real items and the statements that matter here (read 2026-10-14). The
// Hathoric capital N 384's collection statement is left out, so only its
// location chain can keep it: Room 325 has no coordinate, the Sully Wing does.
const LOUVRE_PALACE = 1075988;
const LOUVRE = 19675;
const SULLY_WING = 17309954;
const ROOM_325 = 19119449;
const CAPITAL = 106692454;
const MONA_LISA = 12418;
const MUSEUM = 33506;
const PAINTING = 3305213;
const LEONARDO = 762;
const ROOM = 180516;

const lines = [
  dumpLine('P625', 'coordinate location'),
  dumpLine(`Q${LOUVRE_PALACE}`, 'Louvre Palace', [{ property: 625, value: at(48.861, 2.336) }]),
  dumpLine(`Q${LOUVRE}`, 'Louvre', [
    { property: 31, value: item(MUSEUM) }, { property: 276, value: item(LOUVRE_PALACE) },
    { property: 625, value: at(48.861, 2.3358) },
  ]),
  dumpLine(`Q${SULLY_WING}`, 'Sully Wing', [
    { property: 361, value: item(LOUVRE_PALACE) }, { property: 625, value: at(48.8605, 2.3383) },
  ]),
  dumpLine(`Q${ROOM_325}`, 'Room 325', [{ property: 31, value: item(ROOM) }, { property: 276, value: item(SULLY_WING) }]),
  dumpLine(`Q${CAPITAL}`, 'Hathoric capital N 384', [{ property: 276, value: item(ROOM_325) }]),
  dumpLine(`Q${MONA_LISA}`, 'Mona Lisa', [
    { property: 31, value: item(PAINTING) }, { property: 170, value: item(LEONARDO) },
    { property: 276, value: item(LOUVRE) },
  ]),
  dumpLine(`Q${PAINTING}`, 'painting', [{ property: 279, value: item(1) }]),
  dumpLine(`Q${MUSEUM}`, 'museum', [{ property: 279, value: item(2) }]),
  dumpLine(`Q${ROOM}`, 'room', []),
  dumpLine(`Q${LEONARDO}`, 'Leonardo da Vinci', [{ property: 31, value: item(5) }]),
];

function scopeOf(input: string[]) {
  const collector = new ScopeCollector();
  for (const line of ['[', ...input, ']']) collector.line(line);
  return collector.finish();
}

describe('the items the local Wikidata subset keeps (#1434)', () => {
  const { kept, properties, counts } = scopeOf(lines);

  it('keeps every item with a coordinate and every class', () => {
    for (const id of [LOUVRE_PALACE, LOUVRE, SULLY_WING, PAINTING, MUSEUM]) expect(kept.has(id)).toBe(true);
    expect(counts.coordinates).toBe(3);
    expect(counts.classes).toBe(2);
  });

  it('keeps a placeless cast group named only by a cast based on it (#880)', () => {
    const scope = scopeOf([
      dumpLine('Q130544842', 'The Thinker, Kyoto', [
        { property: 625, value: at(34.99, 135.7723) }, { property: 144, value: item(18003128) },
      ]),
      dumpLine('Q18003128', 'The Thinker', [{ property: 31, value: item(28890616) }]),
    ]);
    expect(scope.kept.has(130544842)).toBe(true);
    expect(scope.kept.has(18003128)).toBe(true);
  });

  it('keeps a work that names a place with a coordinate', () => {
    expect(kept.has(MONA_LISA)).toBe(true);
  });

  it('keeps an item at the end of a chain with no coordinate on the way', () => {
    expect(kept.has(ROOM_325)).toBe(true);
    expect(kept.has(CAPITAL)).toBe(true);
    expect(counts.chains).toBe(1);
  });

  it('keeps a seed\'s class but not the maker a kept work names', () => {
    expect(kept.has(ROOM)).toBe(false);
    expect(kept.has(MUSEUM)).toBe(true);
    expect(kept.has(LEONARDO)).toBe(false);
  });

  it('keeps every property and counts what the kept lines weigh', () => {
    expect([...properties]).toEqual([625]);
    expect(counts.keptBytes).toBeGreaterThan(0);
    expect(counts.keptBytes).toBeLessThan(counts.bytes);
  });

  it('keeps what a seed depicts or commemorates, one hop, and not what a work depicts (#1832)', () => {
    // The Bronze Horseman stands on Senate Square and depicts Peter the Great;
    // the Jefferson Memorial commemorates Thomas Jefferson. Neither person has
    // a coordinate. The Mona Lisa is no seed, so Lisa del Giocondo stays out,
    // and nothing Peter the Great names is followed.
    const HORSEMAN = 672444, PETER = 8479, JEFFERSON_MEMORIAL = 326183, JEFFERSON = 11812;
    const LISA = 153032, MOSCOW = 649;
    const subjects = scopeOf([
      dumpLine(`Q${HORSEMAN}`, 'Bronze Horseman', [
        { property: 625, value: at(59.9364, 30.3022) }, { property: 180, value: item(PETER) },
      ]),
      dumpLine(`Q${JEFFERSON_MEMORIAL}`, 'Jefferson Memorial', [
        { property: 625, value: at(38.8814, -77.0365) }, { property: 547, value: item(JEFFERSON) },
      ]),
      dumpLine(`Q${PETER}`, 'Peter the Great', [{ property: 31, value: item(5) }, { property: 180, value: item(MOSCOW) }]),
      dumpLine(`Q${JEFFERSON}`, 'Thomas Jefferson', [{ property: 31, value: item(5) }]),
      dumpLine(`Q${MONA_LISA}`, 'Mona Lisa', [{ property: 180, value: item(LISA) }]),
      dumpLine(`Q${LISA}`, 'Lisa del Giocondo', [{ property: 31, value: item(5) }]),
      dumpLine(`Q${MOSCOW}`, 'Moscow', []),
    ]);
    expect(subjects.kept.has(PETER)).toBe(true);
    expect(subjects.kept.has(JEFFERSON)).toBe(true);
    expect(subjects.kept.has(LISA)).toBe(false);
    expect(subjects.kept.has(MOSCOW)).toBe(false);
    expect(subjects.counts.seedNeighbours).toBe(2);
  });

  it('gives up a chain that never reaches a coordinate', () => {
    const lost = scopeOf([
      dumpLine('Q1', 'a', [{ property: 361, value: item(2) }]),
      dumpLine('Q2', 'b', [{ property: 361, value: item(3) }]),
      dumpLine('Q3', 'c'),
    ]);
    expect(lost.counts.kept).toBe(0);
  });
});
