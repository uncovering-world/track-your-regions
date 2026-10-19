import { describe, expect, it } from 'vitest';
import { buildCoveringSet, deepestCommonDivisions, type PointDivision } from './pointCovering.js';

/**
 * The GADM chains below are the dev database's for each point: the divisions
 * the unscoped containment query answers, ancestors included, with their
 * depth and root.
 */
function chain(...divisions: Array<[number, string, number | null]>): PointDivision[] {
  const root = divisions[0][0];
  return divisions.map(([id, name, parentId], depth) => ({
    id, name, parentId, gadmDepth: depth, rootId: root,
    path: divisions.slice(0, depth + 1).map(d => d[1]).join(' > '),
  }));
}

const AFRICA: [number, string, null] = [827, 'Africa', null];
const EGYPT: [number, string, number] = [57437, 'Egypt', 827];
const AL_QAHIRAH: [number, string, number] = [57583, 'Al Qahirah', 57437];

/** Tahrir Square (31.2357, 30.0444). */
const TAHRIR = chain(AFRICA, EGYPT, AL_QAHIRAH, [57619, 'Qasr an-Nil', 57583]);
/** The Citadel of Cairo (31.2600, 30.0287). */
const CITADEL = chain(AFRICA, EGYPT, AL_QAHIRAH, [57591, 'Al-Khalifa', 57583]);
/** Luxor Temple (32.6396, 25.6872). */
const LUXOR = chain(AFRICA, EGYPT, [57640, 'Al Uqsur', 57437], [57641, 'Luxor', 57640]);
/** Aswan (32.8998, 24.0889). */
const ASWAN = chain(AFRICA, EGYPT, [57679, 'Aswan', 57437], [57682, 'Aswan', 57679]);
/** Amman (35.9284, 31.9454). */
const AMMAN = chain([1, 'Asia', null], [223375, 'Jordan', 1], [223379, 'Amman', 223375], [223380, 'Amman', 223379]);

const names = (offered: Array<{ name: string }>) => offered.map(d => d.name);

describe('deepestCommonDivisions, Point Match with no matched ancestor', () => {
  it('offers the deepest division holding a lone point, not the continent and the country beside it', () => {
    expect(names(deepestCommonDivisions([TAHRIR]))).toEqual(['Qasr an-Nil']);
  });

  it('offers the governorate that holds the points of two Cairo districts, and neither district', () => {
    expect(names(deepestCommonDivisions([TAHRIR, CITADEL]))).toEqual(['Al Qahirah']);
  });

  it('offers the country for points in two of its governorates, and no division beside its descendant', () => {
    const offered = deepestCommonDivisions([LUXOR, ASWAN]);
    expect(names(offered)).toEqual(['Egypt']);
    expect(offered[0]).toEqual({ id: 57437, name: 'Egypt', parentId: 827, gadmDepth: 1, path: 'Africa > Egypt' });
  });

  it('matches the points under each GADM root on their own', () => {
    expect(names(deepestCommonDivisions([TAHRIR, CITADEL, AMMAN]))).toEqual(['Al Qahirah', 'Amman']);
  });

  it('counts a point under the root of its deepest division only', () => {
    // Overlapping simplified outlines: a point held down to the district on
    // both sides is grouped under Asia, whose Amman comes first, and Qasr
    // an-Nil, the lower id at the same depth, is not offered for it.
    const overlap = [...AMMAN, ...TAHRIR];
    expect(names(deepestCommonDivisions([overlap]))).toEqual(['Amman']);
    expect(names(deepestCommonDivisions([overlap, TAHRIR]))).toEqual(['Amman', 'Qasr an-Nil']);
  });

  it('offers nothing for points no division holds', () => {
    expect(deepestCommonDivisions([[], []])).toEqual([]);
  });
});

describe('buildCoveringSet, Point Match under a matched ancestor', () => {
  it('offers the shallowest divisions below the scope and drops their descendants', () => {
    // Scoped under Egypt, the query numbers depth from the scope.
    const scoped = [...TAHRIR, ...LUXOR].filter(d => d.gadmDepth >= 1)
      .map(d => ({ ...d, gadmDepth: d.gadmDepth - 1, rootId: null }));
    const map = new Map(scoped.map(d => [d.id, d]));
    expect(names(buildCoveringSet(map, new Set([57437]), new Set()))).toEqual(['Al Qahirah', 'Al Uqsur']);
  });
});
