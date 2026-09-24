/**
 * A model's review of a region's children, read key by key (ADR-0066): the
 * audit that proposes adding, removing and renaming children, and the
 * enrichment that names each one's Wikivoyage page and Wikidata item. What
 * the model adds, or gets the type of wrong, stays on the server.
 */

/** One change the audit proposes, on a child named by its name. */
export interface NormalizedAction {
  type: 'add' | 'remove' | 'rename';
  name: string;
  newName?: string;
  reason: string;
}

/** A child's Wikivoyage page and Wikidata item, as the enrichment names them. */
export interface Enrichment {
  name: string;
  wikivoyageTitle: string | null;
  wikidataQID: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

const ACTION_TYPES = new Set(['add', 'remove', 'rename']);

/**
 * One audit action. An addition names the child to add (`name`); a removal or
 * rename names the existing child (`childName`). An action of another type, or
 * naming no child, is none; so is a rename without a new name, which renames
 * to nothing.
 */
function auditActionOf(entry: unknown): NormalizedAction | null {
  if (!isRecord(entry) || typeof entry.type !== 'string' || !ACTION_TYPES.has(entry.type)) return null;
  const type = entry.type as NormalizedAction['type'];
  const name = nonEmptyString(type === 'add' ? entry.name : entry.childName);
  if (!name) return null;
  const reason = typeof entry.reason === 'string' ? entry.reason : '';
  if (type !== 'rename') return { type, name, reason };
  const newName = nonEmptyString(entry.newName);
  return newName ? { type, name, newName, reason } : null;
}

/** The audit's actions, read one at a time, and its account. */
export function auditOf(value: unknown): { actions: NormalizedAction[]; analysis: string } {
  if (!isRecord(value)) return { actions: [], analysis: '' };
  const entries: unknown[] = Array.isArray(value.actions) ? value.actions : [];
  return {
    actions: entries.map(auditActionOf).filter((action): action is NormalizedAction => action !== null),
    analysis: typeof value.analysis === 'string' ? value.analysis : '',
  };
}

/**
 * The enrichment's entries. One that names no child is left out; a Wikidata
 * id that is not a `Q` number is read as none.
 */
export function enrichmentsOf(value: unknown): Enrichment[] {
  if (!isRecord(value) || !Array.isArray(value.enrichments)) return [];
  return value.enrichments.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const name = nonEmptyString(entry.name);
    if (!name) return [];
    const qid = typeof entry.wikidataQID === 'string' && /^Q\d+$/.test(entry.wikidataQID) ? entry.wikidataQID : null;
    return [{ name, wikivoyageTitle: nonEmptyString(entry.wikivoyageTitle), wikidataQID: qid }];
  });
}
