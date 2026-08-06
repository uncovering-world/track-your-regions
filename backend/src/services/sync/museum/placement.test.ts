import { describe, it, expect } from 'vitest';
import { placeArtwork, type VenueStatement } from './placement.js';

// Resolution is stubbed: a room and an umbrella resolve to nothing, museums to themselves.
const RESOLVES: Record<string, string | null> = {
  prado: 'prado', royalPalace: 'royalPalace', tate: null, tateBritain: 'tateBritain',
  nationalGallery: 'nationalGallery', galleryOfHonour: null, rijksmuseum: 'rijksmuseum',
  amsterdamMuseum: 'amsterdamMuseum', munichCCP: 'munichCCP', czartoryski: 'czartoryski',
  nmKrakow: 'nmKrakow', tateModern: 'tateModern', philadelphia: 'philadelphia', sfmoma: 'sfmoma',
  branch: 'branch', museum: 'museum', umbrella: null,
  // A reciprocal P361 pair: two records of one institution that each name the other.
  twinA: 'twinA', twinB: 'twinB',
};
const resolve = (q: string) => RESOLVES[q] ?? null;
const PARENTS: Record<string, string[]> = {
  tateBritain: ['tate'], tateModern: ['tate'], czartoryski: ['nmKrakow'],
  // Three levels, so a direct-parent-only ancestorsOf and a transitive one disagree.
  branch: ['museum'], museum: ['umbrella'],
  twinA: ['twinB'], twinB: ['twinA'],
};
// Full P361 closure, not just the direct parent — see the transitivity test below for why.
const ancestorsOf = (q: string): ReadonlySet<string> => {
  const seen = new Set<string>();
  let frontier = PARENTS[q] ?? [];
  while (frontier.length) {
    const next: string[] = [];
    for (const p of frontier) {
      // `next === qid` is skipped the way venueGraph.makeAncestors skips it, so a
      // reciprocal pair does not make a venue its own ancestor here either.
      if (p !== q && !seen.has(p)) {
        seen.add(p);
        next.push(...(PARENTS[p] ?? []));
      }
    }
    frontier = next;
  }
  return seen;
};
const s = (venue: string, property: 'P195' | 'P276', rank: 'preferred' | 'normal' = 'normal'): VenueStatement =>
  ({ venue, property, rank });

describe('placeArtwork', () => {
  it('drops a location the owner contradicts (Las Meninas)', () => {
    // P276 names the Royal Palace of Madrid, where they hung before 1819 and where Wikidata
    // never closed the statement. Agreement on the Prado wins.
    expect(placeArtwork([s('prado', 'P195'), s('prado', 'P276'), s('royalPalace', 'P276')], resolve, ancestorsOf))
      .toEqual(['prado']);
  });

  it('lets a location corroborate an umbrella owner (Ophelia)', () => {
    // P195 = Tate (an umbrella that resolves to nothing) + National Gallery (who owned it
    // before 1897). P276 = Tate Britain, whose ancestor is Tate. Agreement must see the
    // umbrella, so matching happens on raw values, before resolution.
    expect(placeArtwork([s('tate', 'P195'), s('nationalGallery', 'P195'), s('tateBritain', 'P276')], resolve, ancestorsOf))
      .toEqual(['tateBritain']);
  });

  it('does not let a preferred room silence a normal museum (Syndics of the Drapers Guild)', () => {
    // The preferred P276 is the Rijksmuseum's Gallery of Honour, a room and no venue. Applying
    // rank before resolution emptied the locations, dropped to ownership, and admitted the
    // Amsterdam Museum, which owns the painting but does not show it.
    expect(placeArtwork([
      s('rijksmuseum', 'P195'), s('amsterdamMuseum', 'P195'),
      s('galleryOfHonour', 'P276', 'preferred'), s('rijksmuseum', 'P276'),
    ], resolve, ancestorsOf)).toEqual(['rijksmuseum']);
  });

  it('obeys rank when the preferred statement resolves (Lady with an Ermine)', () => {
    // Editors marked the Czartoryski Museum preferred and left the Munich Central Collecting
    // Point, a Nazi-era art depot, at normal rank. That is an explicit human judgement.
    // munichCCP resolves to a real venue (it was a real depot) so this pins that rank actually
    // drops the normal-rank statement — if it resolved to nothing, ownership would come out to
    // just Czartoryski anyway and the rank gate could be deleted without this test noticing.
    expect(placeArtwork([s('munichCCP', 'P195'), s('czartoryski', 'P195', 'preferred')], resolve, ancestorsOf))
      .toEqual(['czartoryski']);
  });

  it('prefers the branch over its parent organisation (Lady with an Ermine, continued)', () => {
    // The Czartoryski Museum is P361 part of the National Museum in Kraków, 500 m away. Two
    // separate visits, and the work is in the branch. The Amsterdam Museum is an unrelated
    // second owner: without it, this case is indistinguishable from the plain owner-fallback
    // (czartoryski would win even if agreement never fired), so it cannot pin that agreement is
    // what is choosing the branch here rather than the fallback happening to land on it too.
    expect(placeArtwork(
      [s('czartoryski', 'P195'), s('amsterdamMuseum', 'P195'), s('nmKrakow', 'P276')], resolve, ancestorsOf,
    )).toEqual(['czartoryski']);
  });

  it('needs the full P361 closure, not just the direct parent, to see agreement', () => {
    // branch -> museum -> umbrella. P195 names the umbrella; P276 names both the branch and its
    // direct parent. A direct-parent-only ancestorsOf sees the umbrella agree with the museum
    // (one hop) but not with the branch (two hops), and mostSpecific then keeps the museum —
    // the wrong building. A transitive ancestorsOf sees the umbrella agree with both, and
    // mostSpecific narrows to the branch.
    expect(placeArtwork([s('umbrella', 'P195'), s('branch', 'P276'), s('museum', 'P276')], resolve, ancestorsOf))
      .toEqual(['branch']);
  });

  it('keeps every owner when nothing corroborates any of them (Fountain)', () => {
    // Duchamp's Fountain has five authorised replicas; each owner is true.
    expect(placeArtwork([s('tateModern', 'P195'), s('philadelphia', 'P195'), s('sfmoma', 'P195')], resolve, ancestorsOf).sort())
      .toEqual(['philadelphia', 'sfmoma', 'tateModern']);
  });

  it('falls back to location when there is no owner at all (Sunflowers)', () => {
    expect(placeArtwork([s('philadelphia', 'P276'), s('sfmoma', 'P276')], resolve, ancestorsOf).sort())
      .toEqual(['philadelphia', 'sfmoma']);
  });

  it('keeps a work whose two venues each name the other as their container', () => {
    // Wikidata holds reciprocal P361 pairs — the fold rule exists for nothing else. Each twin is
    // the other's ancestor, so a plain "is anyone below me" filter drops both and returns
    // nothing: the work goes to `homeless`, and a venue holding only that work leaves the
    // catalogue with it. Agreement across both properties, the strongest evidence there is,
    // would be the thing that deleted it.
    expect(placeArtwork([s('twinA', 'P195'), s('twinB', 'P276')], resolve, ancestorsOf).sort())
      .toEqual(['twinA', 'twinB']);
  });

  it('still drops the parent when the ancestry only runs one way', () => {
    // The tie above must not become a licence to keep everything: a branch inside an
    // organisation is not a cycle, and the work belongs to the door a visitor walks through.
    expect(placeArtwork([s('branch', 'P195'), s('museum', 'P276')], resolve, ancestorsOf))
      .toEqual(['branch']);
  });

  it('picks the owner when owner and location both resolve but neither corroborates the other', () => {
    // National Gallery (P195) and Tate Britain (P276) share no P361 family in this fixture, so
    // agreement never fires and the code falls back to ownership. This pins current behaviour,
    // not a settled decision: whether ownership should beat visitability when the two flatly
    // disagree is still open. Do not change this test to make a different fallback "pass" —
    // change it only alongside a deliberate decision about which side should win.
    expect(placeArtwork([s('nationalGallery', 'P195'), s('tateBritain', 'P276')], resolve, ancestorsOf))
      .toEqual(['nationalGallery']);
  });
});
