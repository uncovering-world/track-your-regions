/**
 * Neither property is reliably current. P195 (collection) leaves the National Gallery owning
 * the Pre-Raphaelites it transferred to the Tate in 1897; P276 (location) leaves the Royal
 * Palace of Madrid hosting the Prado's Meninas. What separates the true statement from the
 * residue is corroboration: the venue the *other* property also names, counting an institution
 * and its P361 family as one.
 *
 * Order matters and cost two wrong versions to find:
 *   - agreement is matched on raw statement values, because an umbrella that resolves to
 *     nothing is exactly what a branch corroborates (Ophelia / Tate);
 *   - rank decides only when at least one preferred statement resolves somewhere, because a
 *     preferred value may be a room (Syndics / Gallery of Honour).
 *
 * Before any of that, the statements can say that the work is nowhere anyone can name
 * (`whereaboutsUnknown`, #868): a work whose location is Wikidata's *unknown value* is not hung
 * at the older venue its other statements still remember. The collector asks that first and
 * places such a work nowhere; a work that no longer exists at all is the collector's other
 * question (`LOST_WORK_ROOT` in `worksCollector.ts`), read off its classes rather than its venues.
 */
export interface VenueStatement {
  /** The entity named, or `null` for an unknown value (`RawStatement.venue` in `queries.ts`). */
  venue: string | null;
  property: 'P195' | 'P276';
  rank: 'preferred' | 'normal';
}

/**
 * Whether the source says nobody can name where the work is.
 *
 * A location (`P276`) whose value is unknown, standing at best rank — preferred, or normal with
 * no preferred location beside it — or a collection (`P195`) whose value is unknown at preferred
 * rank. Read off the real cases (`wbgetentities`, 2026-09-12): *The Concert* carries a preferred
 * unknown location since the day of the Gardner theft; *The Storm on the Sea of Galilee* a
 * preferred unknown collection beside the Gardner at normal rank; *Salvator Mundi* and *The
 * Tower of Blue Horses* an unknown location at normal rank beside normal named ones, which is
 * what "standing" means when nothing is preferred. An unknown collection at normal rank alone
 * says only that the owner is anonymous — *Nude, Green Leaves and Bust* hangs at Tate Modern on
 * loan — and a preferred named location beside a normal unknown one is Wikidata's own answer
 * that the named one is current. An ended unknown value (*The Parsonage Garden at Nuenen*,
 * recovered 2023) never arrives: the query drops every ended statement.
 */
export function whereaboutsUnknown(statements: VenueStatement[]): boolean {
  const locations = statements.filter((s) => s.property === 'P276');
  const bestLocations = locations.some((s) => s.rank === 'preferred')
    ? locations.filter((s) => s.rank === 'preferred')
    : locations;
  if (bestLocations.some((s) => s.venue === null)) return true;
  return statements.some((s) => s.property === 'P195' && s.rank === 'preferred' && s.venue === null);
}

function currentValues(statements: VenueStatement[], property: VenueStatement['property'],
                       resolve: (q: string) => string | null): string[] {
  // An unknown value is not a venue to resolve or to fall back to.
  const ofProperty = statements.filter((s) => s.property === property);
  const preferred = ofProperty.filter((s) => s.rank === 'preferred');
  const named = (list: VenueStatement[]) => list.map((s) => s.venue).filter((v): v is string => v !== null);
  return named(preferred).some((v) => resolve(v)) ? named(preferred) : named(ofProperty);
}

/**
 * @param ancestorsOf Must return the full P361 closure of a QID, not just its direct parent —
 *   sameInstitution and mostSpecific both walk it as one hop. A branch two or more organisations
 *   below the venue an owner or location names is still that institution; a direct-parents-only
 *   implementation stops one hop short and can hand the work to the wrong building.
 */
export function placeArtwork(
  statements: VenueStatement[],
  resolve: (qid: string) => string | null,
  ancestorsOf: (qid: string) => ReadonlySet<string>,
): string[] {
  const owners = currentValues(statements, 'P195', resolve);
  const places = currentValues(statements, 'P276', resolve);

  const sameInstitution = (a: string, b: string) =>
    a === b || ancestorsOf(a).has(b) || ancestorsOf(b).has(a);

  const agreed: string[] = [];
  for (const o of owners) for (const p of places) if (sameInstitution(o, p)) agreed.push(o, p);

  const resolveAll = (qids: string[]) =>
    [...new Set(qids.map(resolve).filter((v): v is string => !!v))];

  // Written as statements, not a ternary chain: sonarjs/no-nested-conditional is an error
  // in this repo, so a nested ternary fails `npm run check`.
  const byAgreement = resolveAll(agreed);
  if (byAgreement.length) return mostSpecific(byAgreement, ancestorsOf);
  const byOwner = resolveAll(owners);
  const chosen = byOwner.length ? byOwner : resolveAll(places);

  return mostSpecific(chosen, ancestorsOf);
}

/**
 * A work that resolves both to a branch and to its parent organisation belongs to the branch.
 *
 * "Above" has to mean *strictly* above, because `P361` does not describe a tree. Wikidata holds
 * reciprocal pairs — `venueGraph.survivorOf` guards the walk against them and
 * `venueFolds.breakFoldCycles` exists for nothing else — and two venues that each name the other
 * are each other's ancestor. A plain "is anyone below me" test drops both, returns nothing, and
 * sends the work to `homeless`: the strongest evidence this module has, two properties naming the
 * same institution, would delete the work. If it was the only iconic work a venue held, the venue
 * goes with it.
 *
 * Mutually-ancestral venues are therefore a tie, and both survive. They are the same institution
 * recorded twice, which is precisely what `foldVenues` merges downstream — so the pin count comes
 * out right without this function having to guess which record is the real one.
 */
function mostSpecific(venues: string[], ancestorsOf: (qid: string) => ReadonlySet<string>): string[] {
  const strictlyAbove = (above: string, below: string) =>
    ancestorsOf(below).has(above) && !ancestorsOf(above).has(below);
  return venues.filter((v) => !venues.some((o) => o !== v && strictlyAbove(v, o)));
}
