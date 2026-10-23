/**
 * The type chips on an open card (#1915), in the colour every other surface
 * draws the object in — one rule, `experienceColors`, rather than a third copy
 * of the palette (#814).
 *
 * A card opened inside a kind's group sits under that kind's header, which
 * already names the kind, so its one chip is the type alone: "Cultural". The
 * card above the groups (#1262) stands over every kind the place is offered in
 * and no header names any of them, so each of its chips names the kind beside
 * the type — the Serapeum of Alexandria reads "Places of worship · Temple" and
 * "Archaeology · Site" — and a kind with no type shows its name alone. The type
 * is worded as the kind's own chips word it (`typeLabelFor`).
 */

import type { Experience } from '../../api/experiences';
import { typeLabelFor } from '../../utils/experienceTypes';
import { experienceColors, type KindColorSet } from '../../utils/kindColors';

export interface TypeChip {
  key: number;
  label: string;
  style: KindColorSet;
}

/** "cultural" reads "Cultural" where the vocabulary has no word of its own for a value. */
function typeWord(kindId: number, type: string): string {
  const label = typeLabelFor(kindId, type);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * The chips of `experience`'s card: one per kind on the card above the groups
 * (`everyKind`), the row's own type otherwise. None where there is nothing to
 * say — a kind with no type, inside its own group.
 */
export function typeChipsFor(
  experience: Pick<Experience, 'kind_id' | 'type' | 'kinds'>, everyKind: boolean,
): TypeChip[] {
  if (everyKind && experience.kinds?.length) {
    return experience.kinds.map(kind => ({
      key: kind.kind_id,
      label: kind.type ? `${kind.kind_name} · ${typeWord(kind.kind_id, kind.type)}` : kind.kind_name,
      style: experienceColors(kind.kind_id, kind.type),
    }));
  }
  if (!experience.type) return [];
  return [{
    key: experience.kind_id,
    label: typeWord(experience.kind_id, experience.type),
    style: experienceColors(experience.kind_id, experience.type),
  }];
}
