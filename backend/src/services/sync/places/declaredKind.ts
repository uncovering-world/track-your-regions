/**
 * A place kind declared as data (#2318): its roots, its types in the order
 * they are read, what makes a candidate no place to visit or another kind's,
 * and its exceptions. One module builds the kind's class trees, its verdict
 * and the adapters the place pass and the surroundings tier read from such a
 * declaration, so a kind of one-point places is its declaration and nothing
 * more: Squares & streets, Towers, Bridges & engineering marvels and the
 * proposed Parks & gardens (#2254).
 *
 * The verdict reads, in order, the same for every kind:
 * 1. what is no place to visit (`GONE` and the kind's own `kills`);
 * 2. what another kind offers (`others`), unless a type of the kind's names it;
 * 3. a candidate no class of the kind names (`noClass`);
 * 4. what the kind shares with another kind, refused unless a class of the
 *    kind's own names it (`shared`);
 * 5. the kind's exceptions, in the order declared (`exceptions`);
 * 6. a candidate with no point on this planet.
 * Its type is the first of the kind's types whose classes it carries, the
 * kind's `fallback` where none does (`retype` aside).
 */

import { fetchClassTree, type QueryRunner, type SparqlFn } from '../wikidataQueries.js';
import { shareOf, type GatheredPlaces, type KindShare, type PlaceKind, type PoolRoot } from './gather.js';
import { classifyByWorldBars } from './worldTier.js';
import type { WorldRead } from './worldBars.js';
import type { WorldHistory } from './worldMemory.js';
import { surroundingsReader, type SurroundingsKind, type SurroundingsReader } from './surroundingsTier.js';
import type { PlaceClassifier } from '../landmarkSyncService.js';
import type { WikidataLandmark } from '../types.js';

/** Classes a declaration names: the trees under `roots`, and `classes` asked by themselves, never their trees. */
export interface ClassRef {
  roots?: readonly string[];
  classes?: readonly string[];
}

/** A tree whose classes refuse a candidate, and the sentence the refusal names it by. */
export interface Refusal {
  root: string;
  reason: string;
}

/**
 * The gone and the unbuilt, refused by every kind before anything else: the
 * Hanging Gardens of Babylon are destroyed, a tower that is a proposal is no
 * tower to climb. Declared once (#2318); a kind adds what else is no place to
 * visit for it (a bare mast, ruins) in its own `kills`.
 */
export const GONE: Readonly<Record<string, Refusal>> = {
  destroyed: { root: 'Q19860854', reason: 'destroyed or demolished' },
  proposed: { root: 'Q811683', reason: 'proposed, not built' },
  underConstruction: { root: 'Q12377751', reason: 'under construction' },
};

/** A kind's exception, read after the classes of the kind named the candidate. */
export type KindException<Type extends string> =
  /**
   * Refused when it carries a class of `when` and no type of `unlessTyped` names it, any type
   * of the kind's where that is absent: Venice's Grand Canal is a canal and a bare thoroughfare.
   */
  | { refuse: 'untyped'; when: string; unlessTyped?: readonly Type[]; reason: string }
  /**
   * Refused when every class of the kind's own that names it is one of `only`, and, where
   * `when` is given, it carries a class of that tree too (outside the kind's classes where
   * `outsideKind`): Cœur Défense is a building complex only the plain `tower` names.
   */
  | { refuse: 'only'; only: string; when?: string; outsideKind?: boolean; reason: string };

/** A place kind, as data. `Type` is its vocabulary (`@tyr/shared/placeTypes`). */
export interface PlaceKindDeclaration<Type extends string> {
  /** Named in a phase message and a log line. */
  name: string;
  /** What one of its places is, for the phase messages: "a tower". */
  what: string;
  logPrefix: string;
  tag: string;
  /** Its types in the order they are read (`typeValues` of its vocabulary). */
  types: readonly Type[];
  /** The type of a place none of its types' classes name: a bare thoroughfare is a street. */
  fallback: Type;
  /** The roots the candidates are asked by, in fame bands on the live service. */
  pool: readonly PoolRoot[];
  /** What names a candidate of the kind. */
  place: ClassRef;
  /** The classes each type is read from; a type absent here has none of its own (the last). */
  typeClasses: Readonly<Partial<Record<Type, ClassRef & { minus?: ClassRef }>>>;
  /** What else is no place to visit for this kind, after `GONE`. */
  kills?: Readonly<Record<string, Refusal>>;
  /** What another kind offers, unless a type of `unlessTyped` names it. */
  others: Readonly<Record<string, Refusal & { unlessTyped?: readonly Type[] }>>;
  /** The refusal of a candidate no class of the kind names, and the trees that name a better reason for it. */
  noClass: { reason: string; unless?: readonly Refusal[] };
  /** What the kind's tree also holds that is another kind's, refused unless a class of the kind's own names it. */
  shared?: Readonly<Record<string, Refusal>>;
  /** Further trees the exceptions name, by name. */
  trees?: Readonly<Record<string, ClassRef>>;
  /** Trees of `trees` whose classes, like `shared`'s, are not the kind's own. */
  notOwn?: readonly string[];
  /** The exceptions, in the order they are read. */
  exceptions?: readonly KindException<Type>[];
  /** A type read over the first one named: a lock that is also a power station's dam is a dam. */
  retype?: { to: Type; from: readonly Type[]; whenTree: string; whenType: Type };
}

/** The class trees a declared kind's rule reads, built from its declaration. */
export interface DeclaredTrees<Type extends string> {
  place: ReadonlySet<string>;
  types: Readonly<Partial<Record<Type, ReadonlySet<string>>>>;
  kills: Readonly<Record<string, ReadonlySet<string>>>;
  others: Readonly<Record<string, ReadonlySet<string>>>;
  noClass: Readonly<Record<string, ReadonlySet<string>>>;
  shared: Readonly<Record<string, ReadonlySet<string>>>;
  named: Readonly<Record<string, ReadonlySet<string>>>;
}

export interface PlaceFacts {
  classes: readonly string[];
  onEarth: boolean;
  lat: number | null;
  lon: number | null;
}

export type DeclaredVerdict<Type extends string> =
  | { pass: true; type: Type }
  | { pass: false; reason: string };

const EMPTY: ReadonlySet<string> = new Set();
const carries = (classes: readonly string[], set: ReadonlySet<string> | undefined) => !!set && classes.some((c) => set.has(c));

/** Every refusal before the kind's classes are read: the gone, then the kind's own kills. */
const killsOf = <Type extends string>(decl: PlaceKindDeclaration<Type>) => ({ ...GONE, ...decl.kills });

/** Walk every tree the declaration names, each root asked once, each its own step. */
export async function fetchDeclaredTrees<Type extends string>(decl: PlaceKindDeclaration<Type>, run: QueryRunner): Promise<DeclaredTrees<Type>> {
  const asked = new Map<string, Set<string>>();
  const tree = async (root: string, label: string): Promise<Set<string>> => {
    const known = asked.get(root);
    if (known) return known;
    await run.step();
    const classes = await fetchClassTree(run.sparql, root, label);
    asked.set(root, classes);
    return classes;
  };
  const classesOf = async (ref: ClassRef, label: string): Promise<Set<string>> => {
    const out = new Set<string>(ref.classes ?? []);
    for (const root of ref.roots ?? []) for (const cls of await tree(root, label)) out.add(cls);
    return out;
  };
  const byKey = async (refusals: Readonly<Record<string, Refusal>>) => {
    const out: Record<string, ReadonlySet<string>> = {};
    for (const [key, { root }] of Object.entries(refusals)) out[key] = await tree(root, `${key} classes`);
    return out;
  };
  run.phase(`Reading what ${decl.what} is...`);
  const types: Partial<Record<Type, ReadonlySet<string>>> = {};
  for (const type of decl.types) {
    const ref = decl.typeClasses[type];
    if (!ref) continue;
    const classes = await classesOf(ref, `${type} classes`);
    if (ref.minus) for (const cls of await classesOf(ref.minus, `${type} classes`)) classes.delete(cls);
    types[type] = classes;
  }
  const place = await classesOf(decl.place, `${decl.name} classes`);
  run.phase(`Reading what ${decl.what} is not...`);
  const kills = await byKey(killsOf(decl));
  const others = await byKey(decl.others);
  const noClass: Record<string, ReadonlySet<string>> = {};
  for (const { root } of decl.noClass.unless ?? []) noClass[root] = await tree(root, 'classes');
  const shared = await byKey(decl.shared ?? {});
  const named: Record<string, ReadonlySet<string>> = {};
  for (const [name, ref] of Object.entries(decl.trees ?? {})) named[name] = await classesOf(ref, name);
  return { place, types, kills, others, noClass, shared, named };
}

/** The most telling type its classes name: the first of the kind's types whose classes it carries, else the kind's fallback. */
export function declaredType<Type extends string>(decl: PlaceKindDeclaration<Type>, classes: readonly string[], trees: DeclaredTrees<Type>): Type {
  const type = decl.types.find((each) => carries(classes, trees.types[each])) ?? decl.fallback;
  const retype = decl.retype;
  if (retype && retype.from.includes(type) && carries(classes, trees.named[retype.whenTree]) && carries(classes, trees.types[retype.whenType])) {
    return retype.to;
  }
  return type;
}

/** Whether a type of `types`, every type of the kind's where absent, names a candidate of `classes`. */
function typed<Type extends string>(decl: PlaceKindDeclaration<Type>, classes: readonly string[], trees: DeclaredTrees<Type>, types?: readonly Type[]): boolean {
  return (types ?? decl.types).some((type) => carries(classes, trees.types[type]));
}

/** Why the classes a candidate carries refuse it before the kind's own are read: no place to visit, another kind's, no class of the kind. */
function refusedByItsClasses<Type extends string>(decl: PlaceKindDeclaration<Type>, classes: readonly string[], trees: DeclaredTrees<Type>): string | null {
  const kill = Object.entries(killsOf(decl)).find(([key]) => carries(classes, trees.kills[key]));
  if (kill) return kill[1].reason;
  const other = Object.entries(decl.others).find(([key, { unlessTyped }]) =>
    carries(classes, trees.others[key]) && !(unlessTyped && typed(decl, classes, trees, unlessTyped)));
  if (other) return other[1].reason;
  if (carries(classes, trees.place)) return null;
  return (decl.noClass.unless ?? []).find(({ root }) => carries(classes, trees.noClass[root]))?.reason ?? decl.noClass.reason;
}

/** Whether an exception refuses a candidate whose own classes of the kind are `own`. */
function exceptionRefuses<Type extends string>(
  decl: PlaceKindDeclaration<Type>, exception: KindException<Type>, classes: readonly string[], own: readonly string[], trees: DeclaredTrees<Type>,
): boolean {
  if (exception.refuse === 'untyped') return carries(classes, trees.named[exception.when]) && !typed(decl, classes, trees, exception.unlessTyped);
  const when = exception.when ? trees.named[exception.when] ?? EMPTY : null;
  const met = when === null || classes.some((c) => when.has(c) && !(exception.outsideKind && trees.place.has(c)));
  const only = trees.named[exception.only] ?? EMPTY;
  return met && own.every((c) => only.has(c));
}

/** Why the kind refuses a candidate its classes name: what it shares with another kind, or one of its exceptions. */
function refusedByTheKind<Type extends string>(decl: PlaceKindDeclaration<Type>, classes: readonly string[], trees: DeclaredTrees<Type>): string | null {
  const notOwn = [...Object.values(trees.shared), ...(decl.notOwn ?? []).map((name) => trees.named[name] ?? EMPTY)];
  const own = classes.filter((c) => trees.place.has(c) && !notOwn.some((set) => set.has(c)));
  const shared = Object.entries(decl.shared ?? {}).find(([key]) => carries(classes, trees.shared[key]));
  if (shared && own.length === 0) return shared[1].reason;
  return (decl.exceptions ?? []).find((exception) => exceptionRefuses(decl, exception, classes, own, trees))?.reason ?? null;
}

/** Whether a candidate is a place of the kind a traveller visits, and the type it is filed under (the order is the module's). */
export function declaredVerdict<Type extends string>(decl: PlaceKindDeclaration<Type>, facts: PlaceFacts, trees: DeclaredTrees<Type>): DeclaredVerdict<Type> {
  const reason = refusedByItsClasses(decl, facts.classes, trees) ?? refusedByTheKind(decl, facts.classes, trees);
  if (reason) return { pass: false, reason };
  if (!facts.onEarth || facts.lat === null || facts.lon === null) return { pass: false, reason: 'no point on Earth' };
  return { pass: true, type: declaredType(decl, facts.classes, trees) };
}

/** A declared kind with what the place pass, the surroundings tier and the coverage report read of it. */
export interface DeclaredKind<Type extends string> {
  kind: PlaceKind<DeclaredTrees<Type>>;
  verdict(facts: PlaceFacts, trees: DeclaredTrees<Type>): DeclaredVerdict<Type>;
  typeOf(classes: readonly string[], trees: DeclaredTrees<Type>): Type;
  /** Decide from the kind's share: the rule, then the world bars (`classifyByWorldBars`). */
  classify(share: KindShare<DeclaredTrees<Type>>, admitted: ReadonlySet<string>, sparql: SparqlFn, read?: WorldRead, history?: WorldHistory):
    ReturnType<typeof classifyByWorldBars>;
  /** The kind in the surroundings tier (ADR-0171): every place-class item measured against its surroundings, the rule over the survivors. */
  surroundings: SurroundingsKind<DeclaredTrees<Type>>;
  /** The kind's classifier as a source of the place pass reads it (`placeSource`). */
  classifier: PlaceClassifier & { surroundings: SurroundingsReader };
}

/** Build a kind's trees, verdict and adapters from its declaration. */
export function declaredKind<Type extends WikidataLandmark['type']>(decl: PlaceKindDeclaration<Type>): DeclaredKind<Type> {
  const kind: PlaceKind<DeclaredTrees<Type>> = {
    name: decl.name,
    trees: (run) => fetchDeclaredTrees(decl, run),
    poolClasses: (trees) => ({ broad: decl.pool, narrow: trees.place }),
    readsContainers: false,
    admissionPool: true,
  };
  const verdict = (facts: PlaceFacts, trees: DeclaredTrees<Type>) => declaredVerdict(decl, facts, trees);
  const typeOf = (classes: readonly string[], trees: DeclaredTrees<Type>) => declaredType(decl, classes, trees);
  const classify: DeclaredKind<Type>['classify'] = (share, admitted, sparql, read, history) =>
    classifyByWorldBars(share, admitted, { verdict, logPrefix: decl.logPrefix }, sparql, read, history);
  const surroundings: SurroundingsKind<DeclaredTrees<Type>> = {
    kind,
    classesOf: (trees) => trees.place,
    typeOf,
    verdict: (entity, share) => verdict({ classes: share.facts.get(entity.qid)?.classes ?? [], onEarth: entity.onEarth, lat: entity.lat, lon: entity.lon }, share.trees),
    logPrefix: decl.logPrefix,
  };
  const classifier = {
    classify: (gathered: GatheredPlaces, admitted: ReadonlySet<string>, sparql: SparqlFn, history?: WorldHistory) =>
      classify(shareOf(gathered, kind), admitted, sparql, undefined, history),
    types: decl.types,
    tag: decl.tag,
    surroundings: surroundingsReader(surroundings),
  };
  return { kind, verdict, typeOf, classify, surroundings, classifier };
}
