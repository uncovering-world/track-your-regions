/**
 * The Wikimedia language code of each official language a country's
 * statements name (#2491): the language's own *Wikimedia language code*
 * (`P424`) at its best rank, or, where it carries none, the code of the
 * nearest language it is a variety of. Standard Chinese (Q727694), official in
 * China and Taiwan, carries no code of its own, and Chinese (Q7850), up its
 * *subclass of* (`P279`) chain, carries `zh`; Moldovan (Q36392) carries none
 * and Romanian (Q7913), its parent, `ro`.
 *
 * The chain is walked breadth-first, `MAX_HOPS` steps at most, each item's
 * parents in the order its reader gives them (the statements' own in the
 * subset, item order live); the first ancestor with a code that names a
 * Wikipedia edition (`wikiOfLanguage`, asked of `editions`) answers, with its
 * codes that do. A code that names no edition (`cmn`) is passed over, and the
 * walk goes on. Neither the ISO 639-1 code (`P218`) nor the ISO 639-3 one
 * (`P305`) is read: Moldovan's `mo` names a closed edition and Standard
 * Chinese's `cmn` none. An ancestor the reader does not know (one the subset
 * does not keep) ends that branch, so a language reached by no known ancestor
 * with a code has none, and its country's places keep the English reading.
 *
 * Read only by the country rule of `ownLanguage.ts`, and deleted with it once
 * regions store their own languages (#1905, ADR-0208).
 */

/** How many `P279` steps a language's chain is walked up for a code. */
export const MAX_HOPS = 3;

/** What a language item says of itself: its codes and the languages it is a subclass of, each at its best rank, in order. */
export interface LanguageNode {
  codes: string[];
  parents: string[];
}

/** Reads the nodes of these items; an item it does not know has no entry. */
export type ReadLanguages = (ids: string[]) => Promise<Map<string, LanguageNode>>;

/** Which of these codes name a Wikipedia edition. */
export type EditionCodes = (codes: string[]) => Promise<Set<string>>;

/** One language's walk: the items of its last level, and every item it has met. */
interface Walk {
  level: string[];
  seen: Set<string>;
}

/** The next level of a walk: every parent of its level it has not met, in order. */
function nextLevel(walk: Walk, nodes: Pick<Nodes, 'get'>): string[] {
  const level: string[] = [];
  for (const id of walk.level) {
    for (const parent of nodes.get(id)?.parents ?? []) {
      if (walk.seen.has(parent)) continue;
      walk.seen.add(parent);
      level.push(parent);
    }
  }
  return level;
}

/** The codes of the first item of `level` with a code that names an edition, or null. */
function firstCodes(level: readonly string[], nodes: Pick<Nodes, 'get'>, real: ReadonlySet<string>): string[] | null {
  for (const id of level) {
    const codes = (nodes.get(id)?.codes ?? []).filter((code) => real.has(code));
    if (codes.length) return codes;
  }
  return null;
}

/** The items a reader knows, read once each. */
class Nodes {
  private readonly known = new Map<string, LanguageNode>();

  constructor(private readonly read: ReadLanguages) {}

  get(id: string): LanguageNode | undefined {
    return this.known.get(id);
  }

  async load(ids: readonly string[]): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => !this.known.has(id));
    if (missing.length) for (const [id, node] of await this.read(missing)) this.known.set(id, node);
  }
}

/** One step up every walk still going: the languages whose new level holds a code are answered, and a walk with no level left ends. */
async function climb(walks: Map<string, Walk>, nodes: Nodes, editions: EditionCodes, out: Map<string, string[]>): Promise<void> {
  for (const walk of walks.values()) walk.level = nextLevel(walk, nodes);
  const reached = [...walks.values()].flatMap((walk) => walk.level);
  await nodes.load(reached);
  const asked = [...new Set(reached.flatMap((id) => nodes.get(id)?.codes ?? []))];
  const real = asked.length ? await editions(asked) : new Set<string>();
  for (const [language, walk] of walks) {
    const codes = firstCodes(walk.level, nodes, real);
    if (codes) out.set(language, codes);
    if (codes || !walk.level.length) walks.delete(language);
  }
}

/** Each language's codes: its own, or its nearest ancestor's that name an edition; a language with neither has no entry. */
export async function codesOfLanguages(languages: readonly string[], read: ReadLanguages, editions: EditionCodes): Promise<Map<string, string[]>> {
  const nodes = new Nodes(read);
  await nodes.load(languages);
  const out = new Map<string, string[]>();
  const walks = new Map<string, Walk>();
  for (const language of new Set(languages)) {
    const own = nodes.get(language)?.codes ?? [];
    if (own.length) out.set(language, own);
    else walks.set(language, { level: [language], seen: new Set([language]) });
  }
  for (let hop = 1; hop <= MAX_HOPS && walks.size; hop++) await climb(walks, nodes, editions, out);
  return out;
}
