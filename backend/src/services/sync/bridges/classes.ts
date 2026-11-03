/**
 * The classes Bridges & engineering marvels reads (#1860, ADR-0131): what a
 * bridge or an engineering work is, the types a reader filters it by, and the
 * classes that make a candidate no place to visit or another kind's.
 *
 * A bridge, an aqueduct, a dam or a tunnel is in when a traveller would go to
 * it or through it for itself: the Charles Bridge, the Pont du Gard, the
 * Hoover Dam, the Channel Tunnel. So are the places on a canal where its
 * engineering is seen, each one place (#1947): a lock, a flight of locks, a
 * boat lift and a canal inclined plane — the Caen Hill flight, the Falkirk
 * Wheel, the Ronquières inclined plane. A canal itself is a long object and
 * waits for a model of its own (#1948). The first five ids were checked with
 * `wbgetentities` on 2026-10-22; lock, flight of locks, boat lift and canal
 * inclined plane were read from the local subset on 2026-10-24.
 */

import type { PoolRoot } from '../places/gather.js';
import type { PlaceKindDeclaration } from '../places/declaredKind.js';
import { typeValues, type PlaceTypeOf } from '@tyr/shared/placeTypes';

/** The roots the candidates are asked by, in fame bands on the live service. */
export const BRIDGE_ROOTS: readonly PoolRoot[] = [
  { qid: 'Q12280', label: 'bridge' },
  { qid: 'Q474', label: 'aqueduct' },
  { qid: 'Q12323', label: 'dam' },
  { qid: 'Q44377', label: 'tunnel' },
  { qid: 'Q105731', label: 'lock' },
  { qid: 'Q1784096', label: 'flight of locks' },
  { qid: 'Q14908', label: 'boat lift' },
];

/**
 * The types a work is filed under, the most telling first (`bridgeType`): the
 * Pont du Gard is an aqueduct that is also a bridge, and the Hong Kong–Zhuhai–
 * Macau link a bridge that is also a tunnel. On a waterway, a canal inclined
 * plane, which Wikidata files under boat lift, is an inclined plane
 * (Ronquières); a lift that is also a lock is a lift (the Peterborough Lift
 * Lock); a flight, which Wikidata files under canal, is a flight before a lock
 * (Caen Hill); and a lock Wikidata also files as a dam is a lock (the Soo
 * Locks, Seattle's Ballard Locks), unless the dam is a power station
 * (`POWER_STATION`): the Dnieper's hydroelectric plants pass ships too and
 * are dams.
 */
export const BRIDGE_TYPES = typeValues('bridges-and-engineering');
export type BridgeType = PlaceTypeOf<'bridges-and-engineering'>;

/** The types of a canal's works a traveller stops at (#1947): a lift or a lock that generates power is filed as a dam (`bridgeType`). */
export const WATERWAY_TYPES: readonly BridgeType[] = ['inclined-plane', 'boat-lift', 'lock-flight', 'lock'];

const TYPE_ROOT: Readonly<Record<BridgeType, string>> = {
  aqueduct: 'Q474', bridge: 'Q12280', dam: 'Q12323', 'inclined-plane': 'Q912618', 'boat-lift': 'Q14908',
  'lock-flight': 'Q1784096', lock: 'Q105731', tunnel: 'Q44377',
};

/**
 * A canal (Q12284): a long object a traveller rarely goes to as a whole, and
 * whose single point lands at one end (the Canal du Midi's in Toulouse). It
 * leaves the kind until long objects have a model of their own (#1948), with
 * the reason a refusal names, unless another class of the kind names it: a
 * navigable aqueduct is an aqueduct, and a flight of locks, which Wikidata
 * files under canal, is a flight.
 */
export const CANAL = { root: 'Q12284', reason: 'a canal: a long object, offered once long objects have a model of their own (#1948)' };

/** A power station (Q159719): a dam that is one is a dam, whatever lock it holds. */
const POWER_STATION = 'Q159719';

/** Never a place to visit, beside the gone and the unbuilt: a proposed tunnel, ruins. */
const KILLS: PlaceKindDeclaration<BridgeType>['kills'] = {
  proposedTunnel: { root: 'Q27464969', reason: 'proposed, not built' },
  ruins: { root: 'Q109607', reason: 'ruins: an archaeological site, not a standing work' },
};

/**
 * What is no engineering work a traveller visits, with the sentence a refusal
 * names it by. A river Wikidata also files as a canal (the Amstel) is a river;
 * a transit line that runs in a tunnel (the Waterloo & City line) is a way to
 * get about, not a sight.
 */
const OTHER_KINDS: PlaceKindDeclaration<BridgeType>['others'] = {
  river: { root: 'Q4022', reason: 'a river, not an engineering work' },
  railwayLine: { root: 'Q728937', reason: 'a railway line, not a sight' },
};

/**
 * An archaeological site (Q839954): an aqueduct or a tunnel of an ended past
 * that only stands as a site, Aqua Marcia or the tunnel of Eupalinos, is
 * Archaeology's (ADR-0131 decision 2), while a Roman bridge still standing
 * and crossed is a bridge.
 */
const ARCHAEOLOGICAL_SITE_ROOT = 'Q839954';

/**
 * Bridges & engineering marvels, declared (#2318): what names a work is every
 * class under a type's root. A canal no class of the kind names is refused
 * with its own reason (#1948); an archaeological site no bridge class names
 * (Aqua Marcia, the tunnel of Eupalinos) is Archaeology's; a lock or a lift
 * that is a power station's dam is a dam. A street is no refusal: Prague
 * files the Charles Bridge as one.
 */
export const BRIDGES_DECLARATION: PlaceKindDeclaration<BridgeType> = {
  name: 'bridges and engineering works',
  what: 'a bridge or an engineering work',
  logPrefix: '[Bridges]',
  tag: 'engineering',
  types: BRIDGE_TYPES,
  fallback: 'bridge',
  pool: BRIDGE_ROOTS,
  place: { roots: Object.values(TYPE_ROOT) },
  typeClasses: Object.fromEntries(Object.entries(TYPE_ROOT).map(([type, root]) => [type, { roots: [root] }])),
  kills: KILLS,
  others: OTHER_KINDS,
  noClass: { reason: 'no bridge or engineering class', unless: [CANAL] },
  trees: {
    archaeologicalSite: { roots: [ARCHAEOLOGICAL_SITE_ROOT] },
    powerStation: { roots: [POWER_STATION] },
  },
  exceptions: [
    { refuse: 'untyped', when: 'archaeologicalSite', unlessTyped: ['bridge'], reason: 'an archaeological site, not a standing work' },
  ],
  retype: { to: 'dam', from: WATERWAY_TYPES, whenTree: 'powerStation', whenType: 'dam' },
};
