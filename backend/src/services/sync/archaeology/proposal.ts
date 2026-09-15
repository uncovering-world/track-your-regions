/**
 * The site half of what one archaeology run proposes: the row a site door
 * candidate becomes, and the line the run says at the end about both doors.
 *
 * A file of its own because `pipeline.ts` is the wiring of the museums and was
 * already at the length the development guide splits at. Nothing here decides
 * anything: what a site is, is `siteTest.ts`; which candidates got this far, is
 * `sites.ts`; whether a row belongs to this door at all, is the pipeline's
 * union.
 */

import type { SiteCandidate, SiteRefusal } from './sites.js';
import type { SiteRefusalGroup } from './siteTest.js';
import type { FilteredEntity } from '../syncOrchestrator.js';

const LOG_PREFIX = '[Archaeology Sync]';

/**
 * A site: the excavation a traveller stands in (ADR-0058 decision 1).
 *
 * It holds no finds and names no `admittedFor`: a site enters on its own fame,
 * and what was dug up there is in a museum somewhere else — the link from a
 * find's `foundAt` to the site row it names is its own ticket.
 */
export interface CollectedArchaeologySite {
  qid: string;
  label: string;
  description: string | null;
  lat: number;
  lon: number;
  imageUrl: string | null;
  sitelinks: number;
  countryLabel: string | null;
  articleUrl: string | null;
  website: string | null;
  type: 'site';
  classes: string[];
  /** What OpenStreetMap said, kept separable on the row (ADR-0059 decision 2). */
  osm: {
    verdict: 'ruin' | 'living' | 'none';
    object: string | null;
    tag: string | null;
    extentFrom: string | null;
    readAt: string;
  };
  /** The extent's WKT in EPSG:4326, or null where OSM gave none. */
  extentWkt: string | null;
  /**
   * What the card says of a row the tree did not vouch for — which signal
   * carried it in (#895); the museum row's key, read by the card already.
   */
  admissionNote?: string;
}

/** A candidate the site door admitted, as the run will write it. */
function siteItemOf(qid: string, site: SiteCandidate): CollectedArchaeologySite {
  const { entity } = site;
  return {
    qid,
    label: entity.label,
    description: entity.description,
    // Non-null by construction: `collectSitesByFame` refuses a placeless
    // candidate by name before it ever reaches this list.
    lat: entity.lat as number,
    lon: entity.lon as number,
    imageUrl: entity.imageUrl,
    sitelinks: entity.sitelinks,
    countryLabel: entity.countryLabel,
    articleUrl: entity.articleUrl,
    website: entity.website,
    type: 'site',
    classes: site.classes,
    osm: site.osm,
    extentWkt: site.extentWkt,
    ...(site.note ? { admissionNote: site.note } : {}),
  };
}

/**
 * The two doors made into one proposal: the items the run writes, and the one
 * list of refusals a curator reads.
 *
 * **A row cannot be both types.** Pompeii reaches the museum door through
 * English Wikipedia's shelf and is refused there for carrying no museum class,
 * and reaches the site door by its own class. One entity is one row with one
 * `type`, so the museum verdict is taken first and the site door yields: what
 * the museum door *admits* is a museum, whatever else its classes say. Measured
 * on the survey of 2026-09-13 no row is admitted by both — the park veto sends
 * every open-air excavation the museum tree reaches to this door — so that is a
 * guard rather than a policy, and a row that ever trips it is a fact worth
 * seeing in the log.
 *
 * **And a row this run writes is never also a refusal.** Pompeii is refused by
 * the museum door and admitted by the site door; a curator asked about a place
 * the same run just put on the map would be reading a defect, not a question.
 * The refusals keep the order they are given in — the fold lines first, so a
 * museum that folded is reported by where it went rather than by a rule that
 * ran on it before the fold was settled — and the first line about an entity is
 * the one kept.
 *
 * Generic in the museum, which is the whole of what this function needs to know
 * about one: the museum's own shape is the pipeline's, and asking for it here
 * would only point the two files at each other.
 */
export function uniteDoors<M extends { qid: string }, R extends FilteredEntity>(doors: {
  museums: M[];
  sites: Map<string, SiteCandidate>;
  /** The museum door's refusals, the fold lines first. */
  museumRefusals: FilteredEntity[];
  /** The site door's own, most famous first. */
  siteRefusals: R[];
}): {
  items: (M | CollectedArchaeologySite)[];
  siteItems: CollectedArchaeologySite[];
  filtered: FilteredEntity[];
  /** The site refusals that survived the union: what the report groups. */
  siteRefusals: R[];
} {
  const admitted = new Set(doors.museums.map((item) => item.qid));
  const siteItems: CollectedArchaeologySite[] = [];
  for (const [qid, site] of doors.sites) {
    if (admitted.has(qid)) {
      // By name, because the line is read by a person: an id alone would have
      // whoever meets this guard look the place up before they can think about
      // it, and the whole point of the line is that the row is worth a thought.
      console.log(
        `${LOG_PREFIX} ${site.entity.label} (${qid}) is admitted as a museum; `
        + 'the site door yields',
      );
      continue;
    }
    siteItems.push(siteItemOf(qid, site));
  }

  const items = [...doors.museums, ...siteItems];
  const written = new Set(items.map((item) => item.qid));
  const filtered = new Map<string, FilteredEntity>();
  for (const entry of [...doors.museumRefusals, ...doors.siteRefusals]) {
    if (written.has(entry.externalId)) continue;
    if (filtered.has(entry.externalId)) continue;
    filtered.set(entry.externalId, entry);
  }
  return {
    items,
    siteItems,
    filtered: [...filtered.values()],
    siteRefusals: doors.siteRefusals.filter((entry) => !written.has(entry.externalId)),
  };
}

/**
 * The order the refusal groups are reported in, and the words each is given.
 *
 * The rule's own order — what the item is not is asked after the map, but a
 * reader of the line wants the two the door turns away most often first: the
 * living places and the cities with no ruin on the map (run 122: 76 and 55
 * against 66 by class or by name), then the class-or-name group, then the two
 * the pool itself can add, a row that fell below the line and a row with no
 * coordinate to pin. A group with nothing in it is not printed: a run says what
 * it did, not what it might have done.
 */
const GROUP_ORDER: readonly SiteRefusalGroup[] = [
  'living', 'no-ruin', 'class-or-name', 'below-the-line', 'placeless',
];

/** What the count on the summary line is a count *of*. */
const GROUP_PHRASES: Record<SiteRefusalGroup, string> = {
  living: 'living places',
  'no-ruin': 'with no ruin on the map',
  'class-or-name': 'by class or by name',
  'below-the-line': 'below the line',
  placeless: 'with no coordinate to pin',
};

/** And the heading over the names of one group. */
const GROUP_HEADINGS: Record<SiteRefusalGroup, string> = {
  living: 'living places',
  'no-ruin': 'no ruin on the map',
  'class-or-name': 'by class or by name',
  'below-the-line': 'below the line',
  placeless: 'no coordinate to pin',
};

/**
 * One group's count, said the way a person would.
 *
 * The living places are a count with a noun, so one of them is written as a
 * sentence rather than as a number with an `s` glued on (`osmNote` in
 * `siteTest.ts` says the same).
 */
const counted = (group: SiteRefusalGroup, howMany: number): string => (
  `${howMany} ${group === 'living' && howMany === 1 ? 'living place' : GROUP_PHRASES[group]}`
);

/**
 * What the run says when it has decided: one summary line for both doors, then
 * the lists that exist nowhere else.
 *
 * A dry run writes nothing, so the museums held for a curator and the museums a
 * find carried over the line can be read back from no table — and they are
 * exactly the rows ADR-0058 decision 2 is judged on. One line per group rather
 * than one per row, so a run admitting eighty-five museums and refusing two
 * hundred sites still reports them in five.
 */
export function reportProposal(proposal: {
  museums: number;
  /** The museums arriving with a question for a curator, by name. */
  held: string[];
  /** The museums a find carried over the place line, as `name (find)`. */
  forFind: string[];
  sites: CollectedArchaeologySite[];
  refused: number;
  treasures: number;
  /** The site door's refusals, after the rows the run writes have been taken out. */
  siteRefusals: SiteRefusal[];
  /**
   * What the venue-side read brought (#890): the finds it kept, by name, and
   * how many objects it refused — the refusals themselves are on the run's
   * changeset, with their classes.
   */
  venueSide: { kept: string[]; refused: number };
}): void {
  const { museums, held, forFind, sites, refused, treasures, siteRefusals, venueSide } = proposal;
  const extents = sites.filter((item) => item.extentWkt).length;
  console.log(
    `${LOG_PREFIX} Admitted ${museums} museums `
    + `(${held.length} held for a curator, `
    + `${forFind.length} for a find they hold) `
    + `and ${sites.length} sites (${extents} with an extent); `
    + `${refused} refused, ${treasures} treasures to write`,
  );
  if (held.length) console.log(`${LOG_PREFIX} held: ${held.join(', ')}`);
  if (forFind.length) console.log(`${LOG_PREFIX} for a find: ${forFind.join(', ')}`);
  console.log(
    `${LOG_PREFIX} from the venue's side: ${venueSide.kept.length} finds kept, `
    + `${venueSide.refused} objects refused`
    + (venueSide.kept.length ? ` — ${venueSide.kept.join(', ')}` : ''),
  );
  if (!siteRefusals.length) return;

  // Grouped by the tag the rule put on each refusal, never by words in the
  // sentence: Lake Bled's names a lake *and* says "with no ruin on the map",
  // and a substring test filed it under the map's answer rather than under the
  // class that refused it. The tag is `SiteRefusalGroup` and this is the only
  // place it is turned into English.
  const groups = GROUP_ORDER
    .map((group) => [
      group, siteRefusals.filter((entry) => entry.group === group),
    ] as const)
    .filter(([, entries]) => entries.length > 0);
  console.log(
    `${LOG_PREFIX} sites refused: `
    + groups.map(([group, entries]) => counted(group, entries.length)).join(', '),
  );
  for (const [group, entries] of groups) {
    console.log(`${LOG_PREFIX} ${GROUP_HEADINGS[group]}: ${entries.map((e) => e.name).join(', ')}`);
  }
}
