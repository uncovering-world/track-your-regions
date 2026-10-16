/**
 * A kind's group narrowed to one type (#589), Map mode's counterpart of
 * Discover's type chips: a World Heritage group in Italy offers Cultural,
 * Natural and Mixed, a Places of worship group Cathedral, Church, Mosque…
 *
 * The choice, held per kind in the experience context, is narrowed to what the
 * region still offers there (`effectiveKindTypes`), so the list and the map's
 * pins (`buildExperienceMarkers`) read one answer.
 */

interface Group<T> {
  kindName: string;
  experiences: T[];
}

/**
 * Each group narrowed to the type chosen for its kind. The row `keepId` names
 * stays whatever its type: a type chosen after a card was opened does not close
 * the card under the reader.
 */
export function narrowGroups<T extends { id: number; type?: string | null }, G extends Group<T>>(
  groups: G[], kindTypes: ReadonlyMap<string, string>, keepId: number | null,
): G[] {
  return groups.map((group) => {
    const type = kindTypes.get(group.kindName);
    return type === undefined ? group
      : { ...group, experiences: group.experiences.filter(row => row.type === type || row.id === keepId) };
  });
}
