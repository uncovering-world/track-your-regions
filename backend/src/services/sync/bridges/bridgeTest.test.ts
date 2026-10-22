/**
 * What Bridges & engineering marvels admits and what it leaves out (#1860),
 * asked on real entities with the classes Wikidata gave them on 2026-10-22.
 */

import { describe, it, expect } from 'vitest';
import type { BridgeTrees } from './classes.js';
import { bridgeVerdict, type BridgeFacts } from './bridgeTest.js';

const BRIDGE = 'Q12280';
const STONE_BRIDGE = 'Q3397526';
const ARCH_BRIDGE = 'Q158438';
const FOOTBRIDGE = 'Q1068842';
const ROMAN_BRIDGE = 'Q1223230';
const CONCRETE_BRIDGE = 'Q3397516';
const BRIDGE_TUNNEL = 'Q5456378';
const AQUEDUCT = 'Q474';
const ROMAN_AQUEDUCT = 'Q13218676';
const NAVIGABLE_AQUEDUCT = 'Q1030403';
const DAM = 'Q12323';
const ARCH_GRAVITY_DAM = 'Q357679';
const CANAL = 'Q12284';
const SHIP_CANAL = 'Q949819';
const GRACHT = 'Q523166';
const TUNNEL = 'Q44377';
const RAILWAY_TUNNEL = 'Q1311958';
const UNDERSEA_TUNNEL = 'Q1317590';
const METRO_TUNNEL = 'Q41971160';
const HYDRO_STATION = 'Q15911738';
const STREET = 'Q79007';
const ANCIENT_ROMAN_STRUCTURE = 'Q14752696';
const DESTROYED = 'Q19860854';
const PROPOSED_TUNNEL = 'Q27464969';
const UNDER_CONSTRUCTION = 'Q12377751';
const ARCHAEOLOGICAL_SITE = 'Q839954';
const RIVER = 'Q4022';
const RAILWAY_LINE = 'Q728937';
const RAPID_TRANSIT_LINE = 'Q15079663';

const none = new Set<string>();
const bridges = new Set([BRIDGE, STONE_BRIDGE, ARCH_BRIDGE, FOOTBRIDGE, ROMAN_BRIDGE, CONCRETE_BRIDGE, BRIDGE_TUNNEL, NAVIGABLE_AQUEDUCT]);
const aqueducts = new Set([AQUEDUCT, ROMAN_AQUEDUCT, NAVIGABLE_AQUEDUCT]);
const dams = new Set([DAM, ARCH_GRAVITY_DAM]);
const canals = new Set([CANAL, SHIP_CANAL, GRACHT]);
const tunnels = new Set([TUNNEL, RAILWAY_TUNNEL, UNDERSEA_TUNNEL, METRO_TUNNEL, BRIDGE_TUNNEL]);
const trees: BridgeTrees = {
  work: new Set([...bridges, ...aqueducts, ...dams, ...canals, ...tunnels]),
  types: { aqueduct: aqueducts, bridge: bridges, dam: dams, canal: canals, tunnel: tunnels },
  kills: {
    destroyed: new Set([DESTROYED]), proposed: none, proposedTunnel: new Set([PROPOSED_TUNNEL]),
    underConstruction: new Set([UNDER_CONSTRUCTION]), ruins: none,
  },
  others: { river: new Set([RIVER]), railwayLine: new Set([RAILWAY_LINE, RAPID_TRANSIT_LINE]) },
  archaeologicalSite: new Set([ARCHAEOLOGICAL_SITE]),
};

const at = (classes: string[]): BridgeFacts => ({ classes, onEarth: true, lat: 1, lon: 1 });

describe('bridgeVerdict', () => {
  it.each([
    ['the Charles Bridge, which Prague also files as a street', [STONE_BRIDGE, ARCH_BRIDGE, FOOTBRIDGE, STREET], 'bridge'],
    ['the Pont du Gard, an aqueduct before a bridge', [ARCH_BRIDGE, STONE_BRIDGE, ROMAN_AQUEDUCT, ROMAN_BRIDGE, ANCIENT_ROMAN_STRUCTURE], 'aqueduct'],
    ['a Roman bridge still standing, though also a site', [BRIDGE, ARCH_BRIDGE, ROMAN_BRIDGE, ARCHAEOLOGICAL_SITE], 'bridge'],
    ['the Magdeburg water bridge', [NAVIGABLE_AQUEDUCT], 'aqueduct'],
    ['the Hong Kong–Zhuhai–Macau link, a bridge before a tunnel', [BRIDGE_TUNNEL], 'bridge'],
    ['the Hoover Dam, a power station too', [ARCH_GRAVITY_DAM, HYDRO_STATION], 'dam'],
    ['the Panama Canal', [SHIP_CANAL], 'canal'],
    ['the Channel Tunnel', [RAILWAY_TUNNEL, UNDERSEA_TUNNEL], 'tunnel'],
  ])('admits %s', (_name, classes, type) => {
    expect(bridgeVerdict(at(classes), trees)).toEqual({ pass: true, type });
  });

  it.each([
    ['the Polcevera Viaduct, collapsed in 2018', [CONCRETE_BRIDGE, DESTROYED], 'destroyed or demolished'],
    ['the Brenner Base Tunnel, not open yet', [RAILWAY_TUNNEL, PROPOSED_TUNNEL], 'proposed, not built'],
    ['the Fehmarn Belt link, being built', [RAILWAY_TUNNEL, UNDER_CONSTRUCTION], 'under construction'],
    ['the Amstel, a river', [RIVER, GRACHT], 'a river, not an engineering work'],
    ['the Waterloo & City line', [RAPID_TRANSIT_LINE, METRO_TUNNEL], 'a railway line, not a sight'],
    ['Aqua Marcia, an aqueduct that stands only as a site', [ROMAN_AQUEDUCT, ARCHAEOLOGICAL_SITE], 'an archaeological site, not a standing work'],
    ['a street no class of the kind names', [STREET], 'no bridge or engineering class'],
  ])('refuses %s', (_name, classes, reason) => {
    expect(bridgeVerdict(at(classes), trees)).toEqual({ pass: false, reason });
  });

  it('refuses a work with no point on Earth', () => {
    expect(bridgeVerdict({ classes: [BRIDGE], onEarth: true, lat: null, lon: null }, trees))
      .toEqual({ pass: false, reason: 'no point on Earth' });
  });
});
