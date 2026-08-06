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
 */
export interface VenueStatement {
  venue: string;
  property: 'P195' | 'P276';
  rank: 'preferred' | 'normal';
}

function currentValues(statements: VenueStatement[], property: VenueStatement['property'],
                       resolve: (q: string) => string | null): string[] {
  const ofProperty = statements.filter((s) => s.property === property);
  const preferred = ofProperty.filter((s) => s.rank === 'preferred');
  const use = preferred.some((s) => resolve(s.venue)) ? preferred : ofProperty;
  return use.map((s) => s.venue);
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
