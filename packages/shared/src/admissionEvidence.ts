/**
 * Why a run admitted a place to a kind, as figures (#2184, #2179): the record
 * a review card lays out as a table, beside the sentence the run writes for
 * the curator (`admissionNote`). The run keeps it on the kind's membership, in
 * `source_records.admission_evidence` (ADR-0225), so a place two kinds ask
 * about carries each kind's record under that kind; the backend's builders
 * write it (`services/sync/admissionRecord.ts`) and the review queue serves it.
 *
 * A record says which tier admitted the place and what decided it, the
 * place's own figures as the run read them, and what they were measured
 * against: the bars of the world tier (ADR-0175), or the medians of the best
 * places around it in the surroundings tier (ADR-0171, ADR-0181). A figure
 * the run did not read is absent, never zero. What a path names beside the
 * figures travels with them: the monuments categories that named a place
 * (#2171), the famous work or find whose figures admitted its holder
 * (ADR-0056, ADR-0164), the OpenStreetMap object that stood in for a class of
 * a site (#895), the ruin mapped under its name (ADR-0188).
 */

/** The tier that admitted the place: the world's, or its surroundings' (ADR-0171). */
export const ADMISSION_TIERS = ['world', 'surroundings'] as const;
export type AdmissionTier = typeof ADMISSION_TIERS[number];

/**
 * What admitted the place:
 * - `editions`: its Wikipedia editions, over the world tier's bar or the
 *   surroundings' median (an archaeology museum's, over the kind's line);
 * - `readers`: its readers a year, over the world tier's bar or the median;
 * - `guided`: its readers over the world tier's bar for a place a guide marks
 *   (a Wikivoyage guide uses it, Atlas Obscura lists it, the World Heritage List
 *   inscribes it, `marks`);
 * - `guides`: the Wikivoyage editions that use it, over the surroundings' median;
 * - `venues`: the cafés, restaurants and bars around it or along it, over the
 *   surroundings' median (ADR-0192, ADR-0194);
 * - `kept`: a place the tier held, kept because what would decide it was not
 *   read this run (`unread`, ADR-0175 decision 6);
 * - `work`: a famous work it holds, over the line or read over the readership
 *   door's bar (`work`, ADR-0023, ADR-0056);
 * - `find`: a famous find an archaeology museum holds (`work`, ADR-0058, ADR-0103, ADR-0164).
 */
export const ADMISSION_DECIDERS = ['editions', 'readers', 'guided', 'guides', 'venues', 'kept', 'work', 'find'] as const;
export type AdmissionDecider = typeof ADMISSION_DECIDERS[number];

/** What a run could not read, where a held place was kept for it. */
export const ADMISSION_UNREAD = ['pool', 'readers', 'guides', 'venues'] as const;
export type AdmissionUnread = typeof ADMISSION_UNREAD[number];

/** The marks a guide puts on a place, which the world tier's third bar reads (ADR-0175, ADR-0185). */
export const ADMISSION_MARKS = ['guide', 'atlas-obscura', 'world-heritage'] as const;
export type AdmissionMark = typeof ADMISSION_MARKS[number];

/** The reference's kind: the bar a place needed to get in (world), or what is typical of the best around it (surroundings). */
export const ADMISSION_REFERENCES = ['needed', 'typical'] as const;
export type AdmissionReferenceKind = typeof ADMISSION_REFERENCES[number];

/** A place's figures, each where the run read it. */
export interface AdmissionFigures {
  /** Its Wikipedia editions. */
  editions?: number;
  /** Its readers a year, in every counted edition (ADR-0055). */
  readers?: number;
  /** The Wikivoyage editions that use it, where the tier counts them (the surroundings'). */
  guides?: number;
  /** The cafés, restaurants and bars within the venue radius of its point (ADR-0192). */
  venues?: number;
  /** The cafés, restaurants and bars per 100 m along its line (ADR-0194). */
  venuesPer100m?: number;
}

/** What the place's figures were measured against. */
export interface AdmissionReference extends AdmissionFigures {
  kind: AdmissionReferenceKind;
  /** The world tier's readers bar for a place a guide marks, where the place carries a mark. */
  guidedReaders?: number;
  /**
   * What a place the world tier held needed to stay, where it stayed rather
   * than entered: the stay share of each bar (ADR-0175 decision 2), or the
   * line's stay for an archaeology museum.
   */
  toStay?: { editions?: number; readers?: number; guidedReaders?: number };
  /**
   * The share of each median a surroundings test asks, where it is not the
   * whole of it: a place passes a test at that share of the median, and a held
   * place at the stay share.
   */
  shares?: { editions?: number; readers?: number; guides?: number; venues?: number };
  /** How far around the place the surroundings reach, in kilometres. */
  radiusKm?: number;
  /** How many of the best places around set each median. */
  best?: number;
  /** How many places of its density lie within the radius. */
  around?: number;
}

/** The famous work or find whose figures admitted the place that holds it. */
export interface AdmissionWork {
  qid: string;
  label: string;
  /** Its Wikipedia editions. */
  editions?: number;
  /** Its readers a year, where its readers admitted it. */
  readers?: number;
  /** Whether its year is a burst: a quarter in one week, or months that swing. */
  burst?: boolean;
  /** The bar its figure cleared: the line its editions reach, or the door's bar its readers reach. */
  needed?: { editions?: number; readers?: number };
}

export interface AdmissionRecord {
  tier: AdmissionTier;
  /** What decided; a field of its own, which the model will keep in a column of its own (`admission_door`). */
  decided: AdmissionDecider;
  /** Every test the place passed, `decided` first, where it passed more than one. */
  cleared?: AdmissionDecider[];
  /** Whether a place the tier held stayed by the stay share of a bar or test rather than entering. */
  stayed?: boolean;
  /** What the run could not read, where `decided` is `kept`. */
  unread?: AdmissionUnread;
  place: AdmissionFigures;
  /** Null where the run read nothing to measure against: a held place kept with no bars read, a work's admission. */
  reference: AdmissionReference | null;
  /** The marks the world tier read of the place. */
  marks?: AdmissionMark[];
  /** English Wikipedia's monuments categories that named the place, where no class of the kind does (#2171). */
  categories?: string[];
  work?: AdmissionWork;
  /** The OpenStreetMap object that stood in for a class of a site (#895): the tag and the element, `historic=ruins`, `way/196493741`. */
  osm?: { tag: string; element: string };
  /** The ruin OpenStreetMap maps near the place under its name, where no object carries its item (ADR-0188). */
  namedRuin?: { name: string; element: string };
}
