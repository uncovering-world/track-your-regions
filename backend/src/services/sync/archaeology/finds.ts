/**
 * What makes an object in a museum a find, and how the finds pool is collected.
 *
 * A find is **something that was dug up**, never something that is old (ADR-0058
 * decision 3). The distinction is the whole of this module and it is a product
 * judgement before it is a query: a catalogue that read the date alone would
 * call the Mediterranean archaeology and the Americas, Africa and the North not
 * — the Aztec sun stone is a `sculpture` of 1510, Sutton Hoo is AD 625, the
 * Oseberg ship AD 820. So there are four ways in, and the date is only the
 * fourth and narrowest of them:
 *
 * 1. the `archaeological artefact` tree, which is Wikidata saying it itself;
 * 2. one of the find classes (`FIND_CLASSES`) — stele, hoard, papyrus, the
 *    seven the tree does not reach;
 * 3. a discovery place (`P189`) on the item, whatever its date;
 * 4. and only then: an object of the art pool made before AD 500, which is the
 *    ancient sculpture and mosaics the art museums' own roots already hold and
 *    that carry no discovery place of their own.
 *
 * Against all four stands one veto: natural history (`NOT_A_FIND`, walked as
 * trees since #890 — the Bendegó meteorite is an `iron meteorite`). The Hope
 * Diamond and Sue the tyrannosaur both come in through a discovery place and
 * neither was dug up by an archaeologist, so the veto is read first and
 * refuses the row whatever else it carries. And before any road, an item with
 * no class at all is nothing this rule can call a find.
 *
 * The pool itself is the shared works collector's (`museum/worksCollector.ts`),
 * given this kind's roots and this rule as its `keep`: the art pool is
 * collected whole in fame bands and then cut down to the finds in it, before
 * the venue statements are read, so a sculpture nobody dug up costs no query.
 * Nothing here writes anything — what a find becomes as a treasure, and where
 * `foundAt` is stored, is the pipeline's and the writer's.
 */

import {
  ANCIENT_ART_ROOTS,
  ANCIENT_ART_WHOLE,
  ANCIENT_CUTOFF_YEAR,
  FIND_CLASSES,
  type ArchaeologyTrees,
} from './classes.js';
import { EDITION_ROOT, type WorkFacts, type WorksCollectorOptions } from '../museum/worksCollector.js';
import type { PoolWork } from '../museum/queries.js';
import type { VenueRule } from '../museum/venueTest.js';

/**
 * What this kind needs to know about a work beyond its pool row: its classes
 * and its discovery place.
 *
 * The collector's own type under this kind's name. It is defined there because
 * the hook that hands it over is there, and nothing under `museum/` may import
 * from a kind's directory; it is named here because a reader of the find rule
 * should not have to go and look.
 */
export type FindFacts = WorkFacts;

/** The classes a row carries, as the rule reads them: the item's own, and the one it arrived under. */
function classesOf(work: PoolWork, facts: FindFacts | undefined): string[] {
  const classes = facts ? [...facts.classes] : [];
  // The pool row's class alone is enough when the facts did not arrive — a batch
  // that failed, or a run that asks for none — and it is the class the reader is
  // being shown besides.
  if (work.typeQid !== null) classes.push(work.typeQid);
  return classes;
}

/**
 * Why a pool work is a find, or null when it is not one.
 *
 * The reasons are ordered as a person would give them, widest and most
 * certain first: what the item *is* before where it was found, and where it was
 * found before how old it is. The artefact tree is asked before a find class
 * label — the Dead Sea Scrolls carry `archaeological artefact` directly and
 * that is the reason; the Rosetta Stone carries no artefact class of its own,
 * only `stele` and `bilingual inscription`, and reads by its find class,
 * `stele`, instead.
 */
export function findReason(
  work: PoolWork,
  facts: FindFacts | undefined,
  trees: ArchaeologyTrees,
): string | null {
  const classes = classesOf(work, facts);
  // An item with no class at all is not an object Wikidata describes: "Gupta
  // art" is an art movement with an inception of 450 and a collection, and no
  // `P31`, and the venue-side read handed it to this rule (#890, run 127).
  // The pool never met one, since the pool is collected by class.
  if (classes.length === 0) return null;
  // The veto reads the walked trees: the Bendegó meteorite is an `iron
  // meteorite`, which the eight roots alone never named (run 127).
  if (classes.some((cls) => trees.notAFind.has(cls))) return null;
  if (classes.some((cls) => trees.artefact.has(cls))) return 'archaeological artefact';
  const found = classes.find((cls) => FIND_CLASSES[cls]);
  if (found) return FIND_CLASSES[found];
  if (facts?.discoveryPlace) return `found at ${facts.discoveryPlace.label}`;
  if (work.year !== null && work.year < ANCIENT_CUTOFF_YEAR) return 'made before AD 500';
  return null;
}

/**
 * The collector options for this kind: the ancient art roots in fame bands, the
 * find classes and the artefact tree whole, and the rule above as the keep.
 *
 * The artefact tree is asked as extra classes rather than as a closure of its
 * own: the run has already walked it (`trees.artefact`), and every class of it
 * carries the same word on the card, because `archaeological artefact` is what
 * a reader of an unlabelled sub-class would be told anyway.
 *
 * No pinned classes and no pinned editions: this kind's roots are objects, and
 * an edition is a print, which nobody dug up. `EDITION_ROOT` is passed all the
 * same, since the collector asks the tree which of its classes are editions and
 * a root it cannot name is a question with no answer.
 */
export function findsCollectorOptions(input: {
  trees: ArchaeologyTrees;
  rule: VenueRule;
  logPrefix: string;
  workFacts: WorksCollectorOptions['workFacts'];
}): WorksCollectorOptions {
  const { trees, rule, logPrefix, workFacts } = input;
  return {
    broadRoots: ANCIENT_ART_ROOTS,
    wholeRoots: ANCIENT_ART_WHOLE,
    pinned: {},
    extraClasses: {
      ...FIND_CLASSES,
      ...Object.fromEntries([...trees.artefact].map((qid) => [qid, 'archaeological artefact'])),
    },
    pinnedEditionClasses: new Set<string>(),
    editionRoot: EDITION_ROOT,
    noun: { work: 'find', works: 'finds' },
    rule,
    logPrefix,
    workFacts,
    keep: (work, facts) => findReason(work, facts, trees) !== null,
  };
}
