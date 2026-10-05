/**
 * A place in one of its kinds (ADR-0084, #1245).
 *
 * A place belongs to no kind; each row carries every kind it is offered in
 * (`kinds`), none of them the primary one. A surface that shows one kind — a
 * Discover list of Archaeology, say — shows the place as that kind sees it: in
 * that kind's colour and with that kind's type, since the Capitoline Museums
 * are a museum in Archaeology and have no type in Art Museums.
 */

interface PlaceKind {
  kind_id: number;
  kind_name: string;
  kind_priority: number;
  type: string | null;
}

interface WithKinds {
  kind_id: number;
  kind_name: string;
  kind_priority: number;
  type: string | null;
  kinds: PlaceKind[];
}

/**
 * The kind a card is opened under when the address names none: the row's own
 * kind where the place is offered in it, otherwise the first it is offered in,
 * and null where it is offered in none. Read off `kinds`, as the kind filter is,
 * so the kind written into the address is one whose list holds the card.
 */
export function kindToOpenIn(row: Pick<WithKinds, 'kind_id' | 'kinds'>): number | null {
  if (row.kinds.some(entry => entry.kind_id === row.kind_id)) return row.kind_id;
  return row.kinds[0]?.kind_id ?? null;
}

/**
 * The row as `kindId` shows it, or null where the place is not offered in that
 * kind. The row's own kind fields are replaced by that kind's, so everything
 * that reads them — the colour, the type chip, the group — reads the kind the
 * reader is looking at.
 */
export function shownInKind<T extends WithKinds>(row: T, kindId: number): T | null {
  const kind = row.kinds.find(entry => entry.kind_id === kindId);
  if (!kind) return null;
  return {
    ...row,
    kind_id: kind.kind_id,
    kind_name: kind.kind_name,
    kind_priority: kind.kind_priority,
    type: kind.type,
  };
}
