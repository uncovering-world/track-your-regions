import { describe, it, expect } from 'vitest';
import { findReason } from './finds.js';
import { buildArchaeologyTrees } from './classes.js';
import type { PoolWork } from '../museum/queries.js';

const trees = buildArchaeologyTrees({ museum: [], park: [], naturalHistory: ['Q1970365'], artefact: ['Q220659', 'Q10855061'] });
const work = (over: Partial<PoolWork>): PoolWork => ({
  qid: 'Q1', label: 'x', sitelinks: 30, imageUrl: null, creators: [], year: null, type: 'sculpture', typeQid: 'Q860861', ...over,
});

describe('findReason', () => {
  it('the Rosetta Stone: a stele, found at Fort Julien, reads as its find class', () => {
    expect(findReason(work({ qid: 'Q48584', label: 'Rosetta Stone', type: 'stele', typeQid: 'Q178743' }),
      { classes: ['Q178743', 'Q861809'], discoveryPlace: { qid: 'Q3077898', label: 'Fort Julien' } }, trees)).toBe('stele');
  });
  it('the Dead Sea Scrolls: an archaeological artefact, the tree read before a find class label', () => {
    expect(findReason(work({ qid: 'Q145780', label: 'Dead Sea Scrolls', type: 'archaeological artefact', typeQid: 'Q220659' }),
      { classes: ['Q220659', 'Q122949469', 'Q5281800'], discoveryPlace: { qid: 'Q223399', label: 'Qumran' } }, trees)).toBe('archaeological artefact');
  });
  it('the Aztec sun stone: a sculpture of 1510 with no discovery place is not a find by date', () => {
    expect(findReason(work({ qid: 'Q786806', year: 1510 }), { classes: ['Q860861'], discoveryPlace: null }, trees)).toBeNull();
  });
  it('the Doryphoros: an ancient sculpture is a find by date', () => {
    // Q1136305, typed `statue` and `artistic canon of body proportions`, made
    // about 450 BC and shown in Naples: no artefact class, no find class and no
    // discovery place on the item, so the date is the only way in.
    expect(findReason(work({ qid: 'Q1136305', label: 'Doryphoros', year: -450, type: 'statue', typeQid: 'Q179700' }),
      { classes: ['Q179700', 'Q1321686'], discoveryPlace: null }, trees)).toBe('made before AD 500');
  });
  it('the Lewis chessmen: the artefact tree is read before the discovery place', () => {
    // Q217796, typed `archaeological find` — which is in the tree — and
    // `sculpture series`, dug up on the Isle of Lewis, made about 1200: far too
    // late for the date cut, and what it *is* answers before where it was found.
    expect(findReason(work({ qid: 'Q217796', label: 'Lewis chessmen', year: 1200, type: 'archaeological find', typeQid: 'Q10855061' }),
      { classes: ['Q10855061', 'Q19479037'], discoveryPlace: { qid: 'Q6453423', label: 'Isle of Lewis' } }, trees)).toBe('archaeological artefact');
  });
  it('the Pompeii Lakshmi: a discovery place makes a find of any class and any date', () => {
    // Q24269542, typed `sculpture` like the rest of the art pool and carrying
    // no inception at all, with `P189` Pompeii: nothing about the class or the
    // date admits it, and where it was dug up is the whole of the reason.
    expect(findReason(work({ qid: 'Q24269542', label: 'Pompeii Lakshmi', sitelinks: 19, year: null }),
      { classes: ['Q860861'], discoveryPlace: { qid: 'Q43332', label: 'Pompeii' } }, trees)).toBe('found at Pompeii');
  });
  it('Sue the tyrannosaur: a skeleton with a discovery place is natural history, not a find', () => {
    // Q1514294, typed `skeleton` and `individual animal` — both in `NOT_A_FIND`
    // — with `P189` the Cheyenne River Indian Reservation. The way in and the
    // veto are both there, and the veto is read first.
    expect(findReason(work({ qid: 'Q1514294', label: 'Sue', year: null, type: 'skeleton', typeQid: 'Q7881' }),
      { classes: ['Q7881', 'Q26401003'], discoveryPlace: { qid: 'Q3025052', label: 'Cheyenne River Indian Reservation' } }, trees)).toBeNull();
  });
  it('a find class on the pool row alone is enough when the facts did not arrive', () => {
    expect(findReason(work({ qid: 'Q5', type: 'hoard', typeQid: 'Q164099' }), undefined, trees)).toBe('hoard');
  });
  it('the Bendegó meteorite: an iron meteorite with a find spot is natural history by the walked tree (#890)', () => {
    // Q4035016, typed `iron meteorite` (Q827989, a subclass of `meteorite`,
    // checked 2026-09-15) and dug up in Bahia: the flat list never named the
    // subclass, and live run 127 wrote it as a find of the Museu Nacional.
    const walked = buildArchaeologyTrees({
      museum: [], park: [], naturalHistory: [], artefact: [], notAFind: ['Q60186', 'Q827989'],
    });
    const meteorite = work({ qid: 'Q4035016', label: 'Bendegó meteorite', type: 'iron meteorite', typeQid: 'Q827989' });
    const facts = { classes: ['Q827989'], discoveryPlace: { qid: 'Q40430', label: 'Bahia' } };
    expect(findReason(meteorite, facts, walked)).toBeNull();
    // The roots floor the tree: a bare `meteorite` is refused even where the
    // walk answered with nothing.
    expect(findReason(work({ type: 'meteorite', typeQid: 'Q60186' }), { classes: ['Q60186'], discoveryPlace: facts.discoveryPlace }, trees)).toBeNull();
  });
  it('the Gebelein mummies: a mummy is a find, though Wikidata files it under skeleton', () => {
    // Q746243, typed `mummy` (Q43616) and nothing else, no discovery place on
    // the item (checked 2026-09-15): the artefact tree is its road in. `mummy`
    // is under both `skeleton` and `individual animal` on Wikidata's P279*,
    // and live run 128, which walked all eight veto roots, withdrew it from
    // the British Museum — so those two are matched flat and never walked.
    const walked = buildArchaeologyTrees({
      museum: [], park: [], naturalHistory: [], artefact: ['Q220659', 'Q43616'],
      notAFind: ['Q40614', 'Q7946', 'Q5283', 'Q60186', 'Q827989', 'Q544041', 'Q83437'],
    });
    expect(findReason(work({ qid: 'Q746243', label: 'Gebelein predynastic mummies', type: 'mummy', typeQid: 'Q43616' }),
      { classes: ['Q43616'], discoveryPlace: null }, walked)).toBe('archaeological artefact');
  });
  it('an item with no class at all is not a find, whatever its date or its collection (#890)', () => {
    // Q283562, "Gupta art": an art movement with an inception of 450, a
    // collection statement and no `P31` — which the venue-side read handed to
    // this rule, and the date road kept.
    expect(findReason(work({ qid: 'Q283562', label: 'Gupta art', year: 450, type: 'object', typeQid: null }),
      { classes: [], discoveryPlace: null }, trees)).toBeNull();
  });
});
