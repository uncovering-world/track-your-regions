/**
 * The published derivation rules for the country canon. Pure functions —
 * sources in, CanonDraft out. THIS FILE IS THE METHODOLOGY the user-facing
 * "Where does this list come from" page describes; keep rule text in
 * provenance strings in sync with any logic change (bump RULES_VERSION).
 */
import {
  RULES_VERSION, UN_OBSERVER_ISO2,
  type CanonDraft, type CanonException, type ClaimDraft, type CountryClass, type CountryDraft,
  type DisputeDraft, type NeCountryFeature, type NeDisputedFeature, type PresetChoiceDraft,
  type PresetDraft, type Provenance, type WikidataCountryRow,
} from './types.js';

export function slugify(name: string): string {
  // Strip combining diacritics (U+0300-U+036F) after NFD decomposition
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function prov(source: string, rule: string, version = RULES_VERSION): Provenance {
  return { source, version, rule };
}

function classify(row: WikidataCountryRow): { cls: CountryClass; rule: string } | null {
  if (row.isUnMember) return { cls: 'un_member', rule: 'un_member: current UN membership (P463->Q1065, no end date)' };
  if (row.iso2 && UN_OBSERVER_ISO2.includes(row.iso2)) {
    return { cls: 'un_observer', rule: 'un_observer: UN GA observer list (un.org non-member states)' };
  }
  if (row.hasLimitedRecognition) return { cls: 'de_facto', rule: 'de_facto: state with limited recognition (P31 Q15634554)' };
  if (row.iso2 && row.sovereignQid) return { cls: 'territory', rule: 'territory: ISO entry with sovereign (P17)' };
  if (row.iso2) return { cls: 'special', rule: 'special: ISO entry, no sovereign, not UN, not limited-recognition' };
  return null; // fails the membership rule entirely
}

function buildCountries(wikidata: WikidataCountryRow[], warnings: string[]): CountryDraft[] {
  const byIso2 = new Map<string, CountryDraft>();
  const drafts: CountryDraft[] = [];
  const byQid = new Map<string, CountryDraft>();
  for (const row of wikidata) {
    const classified = classify(row);
    if (!classified) continue;
    const slug = row.iso2 ? row.iso2.toLowerCase() : slugify(row.label);
    if (row.iso2 && byIso2.has(row.iso2)) {
      warnings.push(`duplicate iso2 ${row.iso2}: kept ${byIso2.get(row.iso2)?.name}, dropped ${row.label} (${row.qid})`);
      continue;
    }
    const draft: CountryDraft = {
      slug, name: row.label, class: classified.cls,
      iso2: row.iso2, iso3: row.iso3, m49: row.isoNumeric,
      sovereignSlug: null, // resolved below once all rows are in
      wikidataQid: row.qid,
      provenance: [prov('wikidata', classified.rule)],
    };
    drafts.push(draft);
    byQid.set(row.qid, draft);
    if (row.iso2) byIso2.set(row.iso2, draft);
  }
  // Second pass: sovereign links (qid -> slug)
  for (const row of wikidata) {
    const draft = byQid.get(row.qid);
    if (draft && row.sovereignQid) draft.sovereignSlug = byQid.get(row.sovereignQid)?.slug ?? null;
  }
  return drafts;
}

interface CountryIndex {
  bySlug: Map<string, CountryDraft>;
  byIso3: Map<string, CountryDraft>;
  byQid: Map<string, CountryDraft>;
}
function indexCountries(countries: CountryDraft[]): CountryIndex {
  return {
    bySlug: new Map(countries.map((c) => [c.slug, c])),
    byIso3: new Map(countries.filter((c) => c.iso3).map((c) => [c.iso3 as string, c])),
    byQid: new Map(countries.filter((c) => c.wikidataQid).map((c) => [c.wikidataQid as string, c])),
  };
}

function buildDisputes(
  neDisputed: NeDisputedFeature[], idx: CountryIndex,
  wikidataByQid: Map<string, WikidataCountryRow>, warnings: string[],
): DisputeDraft[] {
  const out: DisputeDraft[] = [];
  for (const f of neDisputed) {
    const slug = slugify(f.name);
    if (out.some((d) => d.slug === slug)) { warnings.push(`duplicate NE disputed feature ${slug} — kept first`); continue; }
    // Subject: a canon entry this feature IS (existence), matched by QID or by NE self-sovereignty
    const byQid = f.wikidataQid ? idx.byQid.get(f.wikidataQid) : undefined;
    const bySov = f.sovIso3 ? idx.byIso3.get(f.sovIso3) : undefined;
    const subject = byQid && byQid.class === 'de_facto' ? byQid
      : bySov && bySov.class === 'de_facto' ? bySov : null;
    const kind = subject ? 'existence' as const : 'attribution' as const;

    const claims: ClaimDraft[] = [];
    const controller = subject ?? (f.sovIso3 ? idx.byIso3.get(f.sovIso3) ?? null : null);
    if (controller) claims.push({ countrySlug: controller.slug, role: 'controls', note: null });
    const subjectRow = subject?.wikidataQid ? wikidataByQid.get(subject.wikidataQid) : undefined;
    const featureRow = f.wikidataQid ? wikidataByQid.get(f.wikidataQid) : undefined;
    for (const claimantQid of [...(subjectRow?.claimedByQids ?? []), ...(featureRow?.claimedByQids ?? [])]) {
      const claimant = idx.byQid.get(claimantQid);
      if (claimant && !claims.some((c) => c.countrySlug === claimant.slug)) {
        claims.push({ countrySlug: claimant.slug, role: 'claims', note: null });
      }
    }
    if (claims.length === 0) { warnings.push(`dispute ${slug}: no claimants resolved — dropped (add exception if it must exist)`); continue; }
    out.push({
      slug, name: f.name, kind, subjectCountrySlug: subject?.slug ?? null,
      claims, neFeature: f, wikidataQid: f.wikidataQid,
      provenance: [prov('natural-earth', `dispute from NE disputed/breakaway layer (type=${f.type})`)],
    });
  }
  return out;
}

function presetChoice(disputeSlug: string, countsAs: PresetChoiceDraft['countsAs'], countrySlug: string | null, source: string, rule: string): PresetChoiceDraft {
  return { disputeSlug, countsAs, countrySlug, provenance: prov(source, rule) };
}

function buildPresets(disputes: DisputeDraft[], idx: CountryIndex): PresetDraft[] {
  const deFacto: PresetDraft = { slug: 'de_facto', name: 'De facto (who controls)', isDefault: true, choices: [] };
  const un: PresetDraft = { slug: 'un_widely_recognized', name: 'UN / widely recognized', isDefault: false, choices: [] };
  const neutral: PresetDraft = { slug: 'strict_neutral', name: 'Strictly neutral', isDefault: false, choices: [] };
  for (const d of disputes) {
    const controller = d.claims.find((c) => c.role === 'controls');
    const claimant = d.claims.find((c) => c.role === 'claims');
    // de_facto: breakaway counts as independent, else controller takes it
    if (d.kind === 'existence' && d.subjectCountrySlug && controller?.countrySlug === d.subjectCountrySlug) {
      deFacto.choices.push(presetChoice(d.slug, 'independent', null, 'natural-earth', 'de_facto: NE shows the breakaway as self-administering'));
    } else if (controller) {
      deFacto.choices.push(presetChoice(d.slug, 'country', controller.countrySlug, 'natural-earth', 'de_facto: NE de-facto sovereign'));
    } else {
      deFacto.choices.push(presetChoice(d.slug, 'not_counted', null, 'rules', 'de_facto: no controller resolved'));
    }
    // un_widely_recognized
    const subject = d.subjectCountrySlug ? idx.bySlug.get(d.subjectCountrySlug) : undefined;
    if (d.kind === 'existence' && subject && (subject.class === 'un_member' || subject.class === 'un_observer')) {
      un.choices.push(presetChoice(d.slug, 'independent', null, 'un', 'un: subject is a UN member/observer'));
    } else if (claimant) {
      un.choices.push(presetChoice(d.slug, 'country', claimant.countrySlug, 'wikidata', 'un: internationally recognized claimant (P1336)'));
    } else if (controller) {
      un.choices.push(presetChoice(d.slug, 'country', controller.countrySlug, 'natural-earth', 'un: no distinct claimant; controller'));
    } else {
      un.choices.push(presetChoice(d.slug, 'not_counted', null, 'rules', 'un: unresolvable'));
    }
    neutral.choices.push(presetChoice(d.slug, 'not_counted', null, 'rules', 'strict_neutral: everything not_counted'));
  }
  return [deFacto, un, neutral];
}

function applyExceptions(draft: CanonDraft, exceptions: CanonException[]): void {
  for (const ex of exceptions) {
    const stamp = prov('exceptions.json', `${ex.justification} (${ex.source})`);
    const country = draft.countries.find((c) => c.slug === ex.target);
    const dispute = draft.disputes.find((d) => d.slug === ex.target);
    if ('setClass' in ex.action && country) {
      country.class = ex.action.setClass; country.provenance.push(stamp);
    } else if ('dropCountry' in ex.action && country) {
      draft.countries = draft.countries.filter((c) => c !== country);
    } else if ('dropDispute' in ex.action && dispute) {
      draft.disputes = draft.disputes.filter((d) => d !== dispute);
      for (const p of draft.presets) p.choices = p.choices.filter((c) => c.disputeSlug !== ex.target);
    } else if ('mergeInto' in ex.action && country) {
      const survivor = draft.countries.find((c) => c.slug === (ex.action as { mergeInto: string }).mergeInto);
      if (survivor) { survivor.provenance.push(stamp); draft.countries = draft.countries.filter((c) => c !== country); }
      else draft.warnings.push(`exception mergeInto ${JSON.stringify(ex.action)}: survivor not found`);
    } else {
      draft.warnings.push(`exception target not found: ${ex.target}`);
    }
  }
}

export function deriveCanon(input: {
  wikidata: WikidataCountryRow[];
  neCountries: NeCountryFeature[];
  neDisputed: NeDisputedFeature[];
  exceptions: CanonException[];
}): CanonDraft {
  const warnings: string[] = [];
  const countries = buildCountries(input.wikidata, warnings);
  const idx = indexCountries(countries);
  const wikidataByQid = new Map(input.wikidata.map((r) => [r.qid, r]));
  const disputes = buildDisputes(input.neDisputed, idx, wikidataByQid, warnings);
  const presets = buildPresets(disputes, idx);
  const draft: CanonDraft = { countries, disputes, presets, warnings };
  applyExceptions(draft, input.exceptions);
  return draft;
}
