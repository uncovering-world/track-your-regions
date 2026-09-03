import { describe, it, expect } from 'vitest';
import { computeFolds, type FoldCandidate } from './venueFolds.js';

const v = (qid: string, lat: number, lon: number, works = 0, sitelinks = 0): FoldCandidate =>
  ({ qid, lat, lon, works, sitelinks });

describe('computeFolds', () => {
  it('folds a gallery into the palace that contains it', () => {
    // Galleria Palatina is inside Palazzo Pitti, 5 m apart, one ticket
    const folds = computeFolds([v('palatina', 43.7650, 11.2500, 17), v('pitti', 43.76504, 11.25001, 0, 58)],
      (q) => (q === 'palatina' ? ['pitti'] : []));
    expect(folds.palatina?.into).toBe('pitti');
  });

  it('folds into the nearer of two containers that both received a work, whichever order the edges arrive in', () => {
    // A gallery that is part of both a palace (20 m) and a foundation (120 m), each holding a
    // work of its own. wdt:P361 comes back from the endpoint in no fixed order; taking the first
    // qualifying parent named a different museum row on different runs over the same data.
    const gallery = v('gallery', 43.7650, 11.2500, 2);
    const palace = v('palace', 43.7650 + 20 / 110540, 11.2500, 3);
    const foundation = v('foundation', 43.7650 + 120 / 110540, 11.2500, 9);
    for (const parents of [['palace', 'foundation'], ['foundation', 'palace']]) {
      const folds = computeFolds([gallery, palace, foundation], (q) => (q === 'gallery' ? parents : []));
      expect(folds.gallery?.into, parents.join(',')).toBe('palace');
    }
  });

  it('leaves a branch two streets away alone', () => {
    // Czartoryski is P361 part of the National Museum in Kraków but 500 m away: two visits
    const folds = computeFolds([v('czartoryski', 50.0647, 19.9450, 1), v('nmKrakow', 50.0600, 19.9300, 4)],
      (q) => (q === 'czartoryski' ? ['nmKrakow'] : []));
    expect(folds.czartoryski).toBeUndefined();
  });

  it('leaves neighbours that merely share a square alone', () => {
    // Van Gogh Museum and the Stedelijk are 113 m apart on Museumplein: two tickets
    const folds = computeFolds([v('vangogh', 52.3584, 4.8811, 15), v('stedelijk', 52.3592, 4.8797, 1)], () => []);
    expect(folds).toEqual({});
  });

  it('merges two records of one institution at the same spot, keeping the one with the collection', () => {
    // "The Met Fifth Avenue" and the Metropolitan Museum of Art, 7 m apart
    const folds = computeFolds([v('metFifth', 40.7794, -73.9632, 1), v('met', 40.77944, -73.96333, 58)], () => []);
    expect(folds.metFifth?.into).toBe('met');
    expect(folds.met).toBeUndefined();
  });

  it('keeps every loser of a three-way duplicate pointing at the true survivor, not at each other', () => {
    // Three synthetic duplicate records of one museum at the same spot (works 1, 41, 3). Both
    // losers must resolve to dup2, the one true survivor — not to whichever other loser they
    // happened to be compared against last, which is what happens if an already-folded row is
    // reconsidered as a fold target.
    const folds = computeFolds(
      [v('dup1', 43.76796, 11.25508, 1), v('dup2', 43.76792, 11.25512, 41), v('dup3', 43.7679, 11.25505, 3)],
      () => [],
    );
    expect(folds.dup1?.into).toBe('dup2');
    expect(folds.dup3?.into).toBe('dup2');
    expect(folds.dup2).toBeUndefined();
  });

  it('still folds two duplicate records that are equal on both counts', () => {
    // The tie a duplicate Wikidata record actually produces: no placed works and
    // no sitelinks on either, six metres apart. Without a last resort neither
    // loses — in either direction — so nothing merges and the duplicate pin this
    // rule exists to remove survives, which is the one outcome it must not have.
    const folds = computeFolds([v('dupLow', 48.8606, 2.3376), v('dupHigh', 48.86065, 2.33762)], () => []);

    expect(Object.keys(folds)).toHaveLength(1);
    // Whichever way it goes, it must go the same way from both orders.
    const reversed = computeFolds([v('dupHigh', 48.86065, 2.33762), v('dupLow', 48.8606, 2.3376)], () => []);
    expect(Object.keys(reversed)).toEqual(Object.keys(folds));
    expect(reversed[Object.keys(folds)[0]].into).toBe(folds[Object.keys(folds)[0]].into);
  });

  it('merges three records in a chain of same-spot distances into one survivor in every arrival order', () => {
    // A–B 30 m, B–C 25 m, A–C 55 m: "same spot" is a radius, not an equivalence class. Decided
    // pair by pair in arrival order, [A, B, C] gave one row and [C, B, A] gave two — A was never
    // compared with C, and B, already folded, was skipped. Taken from the strongest record down,
    // each row folds into the strongest row within the radius, or into that row's own survivor.
    const a = v('A', 43.7650, 11.2500, 1);
    const b = v('B', 43.7650 + 30 / 110540, 11.2500, 2);
    const c = v('C', 43.7650 + 55 / 110540, 11.2500, 3);
    const orders = [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
    for (const order of orders) {
      const folds = computeFolds(order, () => []);
      const label = order.map((o) => o.qid).join(',');
      expect(folds.A?.into, label).toBe('C');
      expect(folds.B?.into, label).toBe('C');
      expect(folds.C, label).toBeUndefined();
      // The distance the panel prints is to the row the fold names, not to the twin that
      // brought A there: "folded into C — 30 m away" would be a claim about C, and false.
      expect(folds.A?.metres, label).toBe(55);
      expect(folds.B?.metres, label).toBe(25);
    }
  });

  it('does not mistake a degree of longitude for a degree of latitude near the poles', () => {
    // Two records of one institution 81 m apart at 78°N, separated only in longitude. Treating a
    // degree of longitude as a degree of latitude (dropping the cos(lat) term) computes almost
    // 390 m here and misses a fold that is well inside the container radius.
    const folds = computeFolds([v('arcticBranch', 78.0, 15.0035), v('arcticContainer', 78.0, 15.0)],
      (q) => (q === 'arcticBranch' ? ['arcticContainer'] : []));
    expect(folds.arcticBranch?.into).toBe('arcticContainer');
  });

  it('chains a three-level P361 nesting instead of resolving to the final survivor (current behaviour)', () => {
    // A room inside a gallery inside a palace, each ~137 m from its *immediate* parent only (the
    // room is over 250 m from the palace directly, so a one-hop check would miss it — the whole
    // reason parentsOf is walked one relationship at a time). computeFolds does not chase the
    // chain: it records room -> gallery and gallery -> palace as two separately-correct entries,
    // so folds.room.into names 'gallery', which is itself a key of this same map, not 'palace'.
    // This pins today's behaviour on purpose: resolving the chain is the wiring layer's job, not
    // this function's, so a future change that collapses it to a fixed point in here — rather
    // than in the consumer — should fail this test and force that to be a decision, not a shrug.
    const parentsOf: Record<string, string[]> = { room: ['gallery'], gallery: ['palace'] };
    const folds = computeFolds(
      [v('room', 43.7670, 11.2520), v('gallery', 43.7660, 11.2510), v('palace', 43.7650, 11.2500)],
      (q) => parentsOf[q] ?? [],
    );
    expect(folds.room).toBeDefined();
    expect(folds.gallery).toBeDefined();
    expect(folds.room?.into).toBe('gallery');
    expect(folds.gallery?.into).toBe('palace');
  });
});

describe('the door of a venue', () => {
  // Coordinates, sitelinks and distances are the live ones, measured on 2026-09-03.
  const door = (qid: string, lat: number, lon: number, sitelinks: number, works = 0): FoldCandidate =>
    ({ qid, lat, lon, works, sitelinks });

  it('folds a collection into the better-known venue that houses it, though that venue holds no work', () => {
    // Galleria Palatina (12 sitelinks) is located in Palazzo Pitti (59), 5 m away. No work names
    // the palace directly, so it is no venue of this run — and it is still the ticket.
    const palatina = v('palatina', 43.7651, 11.2500, 18, 12);
    const pitti = door('pitti', 43.76514, 11.25004, 59);
    const folds = computeFolds([palatina], () => [], (q) => (q === 'palatina' ? [pitti] : []));
    expect(folds.palatina).toMatchObject({ into: 'pitti', metres: 5 });
    expect(folds.palatina.why).toContain('housed in');
  });

  it('leaves a museum alone when the building it occupies is known by the museum\'s own name', () => {
    // Galleria Borghese (46 sitelinks) is located in Villa Borghese Pinciana (8), 5 m away.
    // Wikidata types the villa a museum; nobody buys a ticket to it under that name.
    const borghese = v('borghese', 41.9142, 12.4922, 16, 46);
    const villa = door('villa', 41.91424, 12.49224, 8);
    expect(computeFolds([borghese], () => [], () => [villa])).toEqual({});
  });

  it('leaves a branch alone when the better-known institution it belongs to is streets away', () => {
    // Czartoryski Museum (30) is part of the National Museum in Kraków (31), 1.2 km away.
    const czartoryski = v('czartoryski', 50.0647, 19.9450, 1, 30);
    const nmKrakow = door('nmKrakow', 50.0620, 19.9280, 31);
    expect(computeFolds([czartoryski], () => [], () => [nmKrakow])).toEqual({});
  });

  it('does not hand a branch to the umbrella organisation that happens to sit beside it', () => {
    // Alte Nationalgalerie (38) is part of the Nationalgalerie (14), whose coordinate lies 200 m
    // away — inside the container radius, and still not the name on the door.
    const alteNg = v('alteNg', 52.5208, 13.3981, 6, 38);
    const nationalgalerie = door('nationalgalerie', 52.5194, 13.3969, 14);
    expect(computeFolds([alteNg], () => [], () => [nationalgalerie])).toEqual({});
  });

  it('decides the door before the same-spot rule, so a building holding a work of its own is not merged into the collection inside it', () => {
    // Musée des Beaux-Arts de la ville de Paris (1 sitelink, 5 works) is located in the Petit
    // Palais (47), 3 m away. If the palace also received a work, the same-spot rule alone would
    // keep the row carrying more works — the collection — and fold the building into it.
    const beauxArts = v('beauxArts', 48.8660, 2.3145, 5, 1);
    const petitPalais = v('petitPalais', 48.86602, 2.31452, 1, 47);
    const folds = computeFolds(
      [beauxArts, petitPalais], () => [], (q) => (q === 'beauxArts' ? [petitPalais] : []),
    );
    expect(folds.beauxArts?.into).toBe('petitPalais');
    expect(folds.petitPalais).toBeUndefined();
  });

  it('walks on from a door to the door of that door, one relationship per entry', () => {
    // A collection housed in a gallery housed in a palace, each better known than the last. The
    // map records each step on its own, as the container rule does; the wiring layer chains it.
    const collection = v('collection', 43.7651, 11.2500, 3, 10);
    const gallery = door('gallery', 43.76512, 11.25002, 20);
    const palace = door('palace', 43.76514, 11.25004, 60);
    const doors: Record<string, FoldCandidate[]> = { collection: [gallery], gallery: [palace] };
    const folds = computeFolds([collection], () => [], (q) => doors[q] ?? []);
    expect(folds.collection?.into).toBe('gallery');
    expect(folds.gallery?.into).toBe('palace');
    expect(folds.palace).toBeUndefined();
  });

  it('takes the nearer of two qualifying doors, whichever order they arrive in', () => {
    const collection = v('collection', 48.8611, 2.3358, 2, 5);
    const near = door('near', 48.8612, 2.3358, 40);
    const far = door('far', 48.8621, 2.3358, 90);
    expect(computeFolds([collection], () => [], () => [far, near]).collection?.into).toBe('near');
    expect(computeFolds([collection], () => [], () => [near, far]).collection?.into).toBe('near');
  });

  it('sends a venue\'s same-spot twin through the same door', () => {
    // One institution recorded under two QIDs 6 m apart, only one of which carries the P276 to
    // the palace. The twin would otherwise be compared against nothing — its sibling is already
    // folded and the door is no venue — and the run would write the palace and the twin as two
    // rows for one place. It follows its sibling, and the chain ends at the door.
    const withDoor = v('withDoor', 43.7651, 11.25, 3, 10);
    const twin = v('twin', 43.76515, 11.25, 5, 12);
    const pitti = door('pitti', 43.76514, 11.25004, 59);
    for (const order of [[withDoor, twin], [twin, withDoor]]) {
      const folds = computeFolds(order, () => [], (q) => (q === 'withDoor' ? [pitti] : []));
      expect(folds.withDoor?.into).toBe('pitti');
      expect(folds.twin?.into).toBe('withDoor');
      expect(folds.pitti).toBeUndefined();
    }
  });

  it('does not send a better-known twin through a door the fame guard refused it', () => {
    // A villa Wikidata types a museum (8 sitelinks) housing a small collection (3) and a
    // Borghese-shaped gallery (46), 20 m apart. The collection goes through the villa's door; the
    // gallery was left standing on fame, and following its twin would take it there anyway.
    const villa = door('villa', 41.9142, 12.4922, 8);
    const small = v('small', 41.91422, 12.49222, 1, 3);
    const gallery = v('gallery', 41.9144, 12.4922, 16, 46);
    for (const order of [[small, gallery], [gallery, small]]) {
      const folds = computeFolds(order, () => [], () => [villa]);
      expect(folds.small?.into).toBe('villa');
      expect(folds.gallery).toBeUndefined();
    }
  });

  it('gives one answer in every arrival order when a refused door, a twin and a duplicate meet', () => {
    // The villa again (8), housing a small collection (3) with the door edge and a gallery (46)
    // the fame guard leaves standing — plus a duplicate record of the gallery (1 sitelink, no
    // location edge) 15 m away. Decided pair by pair in arrival order, the duplicate followed
    // the collection through the door in one order and merged into the gallery in another. The
    // duplicate merges into the gallery: two unfolded rows at one spot are one record twice, and
    // that merge is a total order; only what is still standing afterwards may follow a twin.
    const villa = door('villa', 41.9142, 12.4922, 8);
    const small = v('small', 41.91422, 12.49222, 1, 3);
    const gallery = v('gallery', 41.9144, 12.4922, 16, 46);
    const dup = v('dup', 41.91434, 12.49224, 0, 1);
    const orders = [
      [small, gallery, dup], [small, dup, gallery], [gallery, small, dup],
      [gallery, dup, small], [dup, small, gallery], [dup, gallery, small],
    ];
    for (const order of orders) {
      const folds = computeFolds(order, () => [], (q) => (q === 'small' ? [villa] : []));
      expect(folds.small?.into, order.map((o) => o.qid).join(',')).toBe('villa');
      expect(folds.dup?.into, order.map((o) => o.qid).join(',')).toBe('gallery');
      expect(folds.gallery, order.map((o) => o.qid).join(',')).toBeUndefined();
    }
  });

  it('names one survivor in every arrival order when two container folds cross among four records', () => {
    // b and c 50 m apart — too far to merge — with a and d between them, each within 40 m of
    // both: a is part of c, d is part of b. Deciding reachability on the map as it changed
    // during the follow pass, b followed a in one order and c followed d in another, so which
    // qid was written as the museum's row depended on the order the rows arrived in. Read
    // against a snapshot taken before the pass, both follow, the four close into a ring, and
    // the ring is broken the way every ring here is: the row carrying the collection survives.
    const m = 1 / 110540;
    const b = v('b', 43.765, 11.25, 3);
    const c = v('c', 43.765 + 50 * m, 11.25, 2);
    const a = v('a', 43.765 + 25 * m, 11.25, 1);
    const d = v('d', 43.765 + 25 * m, 11.25 + 10 / 80000, 1);
    const parents: Record<string, string[]> = { a: ['c'], d: ['b'] };
    const permutations = (rows: FoldCandidate[]): FoldCandidate[][] => (rows.length <= 1
      ? [rows]
      : rows.flatMap((r, i) => permutations([...rows.slice(0, i), ...rows.slice(i + 1)]).map((p) => [r, ...p])));
    const end = (folds: Record<string, { into: string }>, q: string): string => {
      let n = q;
      while (folds[n]) n = folds[n].into;
      return n;
    };
    for (const order of permutations([a, b, c, d])) {
      const folds = computeFolds(order, (q) => parents[q] ?? []);
      const label = order.map((o) => o.qid).join(',');
      expect(Object.keys(folds).sort(), label).toEqual(['a', 'c', 'd']);
      for (const q of ['a', 'c', 'd']) expect(end(folds, q), label).toBe('b');
    }
  });

  it('does not send a better-known twin round a container to a door the fame guard refused it', () => {
    // a (2 sitelinks) is part of C (5), 100 m away, and C is housed in the better-known D (20);
    // b (46) stands 30 m from a and was refused D on fame. Following a — a container hop, then
    // a door hop — would land b under D's name all the same. The guard applies to the name at
    // the end of any chain that passes through a door.
    const D = door('D', 43.7660, 11.2500, 20);
    const C = v('C', 43.76601, 11.25001, 3, 5);
    const a = v('a', 43.7651, 11.2500, 1, 2);
    const b = v('b', 43.7651 + 30 / 110540, 11.2500, 1, 46);
    const parents: Record<string, string[]> = { a: ['C'] };
    for (const order of [[a, b, C], [C, b, a], [b, C, a]]) {
      const folds = computeFolds(order, (q) => parents[q] ?? [], (q) => (q === 'C' || q === 'b' ? [D] : []));
      const label = order.map((o) => o.qid).join(',');
      expect(folds.a?.into, label).toBe('C');
      expect(folds.C?.into, label).toBe('D');
      expect(folds.b, label).toBeUndefined();
    }
  });

  it('ranks a door on a ring by its works and sitelinks, not by its qid', () => {
    // V (5 works) is housed in the door D, D is housed in X, and X is part of V, all on one
    // site: the container pass writes X → V, the door walk V → D → X, and the three close into
    // a ring. The ring is broken by strength, and D — a door, no works, 30 sitelinks — must be
    // ranked on that, not on its qid string, which here sorts above V's and would keep the door
    // over the row carrying the collection.
    const V = v('QA', 43.7650, 11.2500, 5, 10);
    const D = door('QM', 43.76505, 11.2500, 30);
    const X = v('QZ', 43.7651, 11.2500, 1, 40);
    const doorsOf: Record<string, FoldCandidate[]> = { QA: [D], QM: [X] };
    for (const order of [[V, X], [X, V]]) {
      const folds = computeFolds(order, (q) => (q === 'QZ' ? ['QA'] : []), (q) => doorsOf[q] ?? []);
      const label = order.map((o) => o.qid).join(',');
      expect(folds.QA, label).toBeUndefined();
      expect(folds.QZ?.into, label).toBe('QA');
      expect(folds.QM?.into, label).toBe('QZ');
    }
  });

  it('records nothing for a venue with no door', () => {
    const lone = v('lone', 52.3584, 4.8811, 15, 60);
    expect(computeFolds([lone], () => [], () => [])).toEqual({});
  });
});

describe('reciprocal P361 pairs', () => {
  const at = (qid: string, lat: number, lon: number, works: number, sitelinks: number) =>
    ({ qid, lat, lon, works, sitelinks });

  it('leaves exactly one survivor when two venues each contain the other', () => {
    // Wikidata has these; without the cycle break the map is {A: into B, B: into A}, so nothing
    // merges, each venue's works are written to the other, and both are reported as folded.
    const a = at('QA', 48.8611, 2.3358, 3, 100);
    const b = at('QB', 48.8612, 2.3358, 9, 50);
    const parents = (q: string) => (q === 'QA' ? ['QB'] : ['QA']);

    const folds = computeFolds([a, b], parents);

    expect(Object.keys(folds)).toEqual(['QA']);
    expect(folds.QA.into).toBe('QB');
  });

  it('keeps the row carrying the collection, not the one that happened to come first', () => {
    const a = at('QA', 48.8611, 2.3358, 12, 10);
    const b = at('QB', 48.8612, 2.3358, 2, 900);
    const parents = (q: string) => (q === 'QA' ? ['QB'] : ['QA']);

    const folds = computeFolds([a, b], parents);

    expect(Object.keys(folds)).toEqual(['QB']);
    expect(folds.QB.into).toBe('QA');
  });

  it('gives the same answer whichever order the venues arrive in', () => {
    const a = at('QA', 48.8611, 2.3358, 4, 4);
    const b = at('QB', 48.8612, 2.3358, 4, 4);
    const parents = (q: string) => (q === 'QA' ? ['QB'] : ['QA']);

    const forwards = computeFolds([a, b], parents);
    const backwards = computeFolds([b, a], parents);

    expect(Object.keys(forwards)).toEqual(Object.keys(backwards));
  });

  it('breaks a three-venue cycle down to one survivor', () => {
    const a = at('QA', 48.8611, 2.3358, 1, 1);
    const b = at('QB', 48.8612, 2.3358, 2, 2);
    const c = at('QC', 48.8613, 2.3358, 3, 3);
    const ring: Record<string, string[]> = { QA: ['QB'], QB: ['QC'], QC: ['QA'] };

    const folds = computeFolds([a, b, c], (q) => ring[q] ?? []);

    // Every member but the strongest folds, and the chain terminates.
    expect(folds.QC).toBeUndefined();
    const walk = (q: string): string => {
      let n = q;
      const seen = new Set([q]);
      while (folds[n]) {
        n = folds[n].into;
        if (seen.has(n)) throw new Error('the chain never terminates');
        seen.add(n);
      }
      return n;
    };
    expect(walk('QA')).toBe('QC');
    expect(walk('QB')).toBe('QC');
  });
});
