/**
 * Lines written the way Wikidata's JSON dump writes them (checked against the
 * 2026-10-05 dump): `type` and `id` first, a property's `datatype` between
 * them, a statement's main snak with no
 * `hash`, a qualifier's snak with one, and the comma after every entity.
 */

type Value = { item: number } | { latitude: number; longitude: number } | { string: string } | { unknown: true };

export interface Statement {
  property: number;
  value: Value;
  rank?: 'preferred' | 'normal' | 'deprecated';
  /** An item-valued qualifier, which a scan for statements must not read as a statement. */
  qualifier?: { property: number; item: number };
}

function datavalue(value: Exclude<Value, { unknown: true }>): string {
  if ('item' in value) {
    return `{"value":{"entity-type":"item","numeric-id":${value.item},"id":"Q${value.item}"},"type":"wikibase-entityid"}`;
  }
  if ('latitude' in value) {
    return `{"value":{"latitude":${value.latitude},"longitude":${value.longitude},"altitude":null,"precision":0.0001,`
      + '"globe":"http:\\/\\/www.wikidata.org\\/entity\\/Q2"},"type":"globecoordinate"}';
  }
  return `{"value":${JSON.stringify(value.string)},"type":"string"}`;
}

function datatype(value: Exclude<Value, { unknown: true }>): string {
  if ('item' in value) return 'wikibase-item';
  return 'latitude' in value ? 'globe-coordinate' : 'string';
}

/** A main snak: a value, or an unknown value (`somevalue`), which carries no `datavalue`. */
function mainsnak(s: Statement): string {
  if ('unknown' in s.value) return `{"snaktype":"somevalue","property":"P${s.property}","datatype":"wikibase-item"}`;
  return `{"snaktype":"value","property":"P${s.property}","datavalue":${datavalue(s.value)},"datatype":"${datatype(s.value)}"}`;
}

function statement(subject: string, s: Statement, index: number): string {
  const qualifiers = s.qualifier
    ? `,"qualifiers":{"P${s.qualifier.property}":[{"snaktype":"value","property":"P${s.qualifier.property}",`
      + `"hash":"22ea48be6d30f4e44b5aba1bfaf4eca5c8cc4a56","datavalue":${datavalue({ item: s.qualifier.item })},`
      + `"datatype":"wikibase-item"}]},"qualifiers-order":["P${s.qualifier.property}"]`
    : '';
  return `{"mainsnak":${mainsnak(s)},"type":"statement"${qualifiers},"id":"${subject}$00000000-0000-0000-0000-${String(index).padStart(12, '0')}",`
    + `"rank":"${s.rank ?? 'normal'}"}`;
}

export interface LineExtras {
  /** site → title */
  sitelinks?: Record<string, string>;
  /** A property's datatype. */
  datatype?: string;
  /** Labels in other languages, which the subset leaves out unless they are among its languages. */
  labels?: Record<string, string>;
  /** language → description; none by default. */
  descriptions?: Record<string, string>;
}

/** One entity as a dump line, labelled in English. */
export function dumpLine(id: string, label: string, statements: Statement[] = [], extras: LineExtras = {}): string {
  const type = id.startsWith('P') ? 'property' : 'item';
  const byProperty = new Map<number, string[]>();
  statements.forEach((s, index) => {
    byProperty.set(s.property, [...(byProperty.get(s.property) ?? []), statement(id, s, index)]);
  });
  const claims = [...byProperty].map(([property, list]) => `"P${property}":[${list.join(',')}]`).join(',');
  const labels = Object.entries({ en: label, ...extras.labels })
    .map(([language, value]) => `"${language}":{"language":"${language}","value":${JSON.stringify(value)}}`).join(',');
  const descriptions = Object.entries(extras.descriptions ?? {})
    .map(([language, value]) => `"${language}":{"language":"${language}","value":${JSON.stringify(value)}}`).join(',');
  const sitelinks = Object.entries(extras.sitelinks ?? {})
    .map(([site, title]) => `"${site}":{"site":"${site}","title":${JSON.stringify(title)},"badges":[]}`).join(',');
  const datatype = extras.datatype ? `"datatype":"${extras.datatype}",` : '';
  return `{"type":"${type}",${datatype}"id":"${id}","labels":{${labels}},`
    + `"descriptions":{${descriptions}},"aliases":{},"claims":{${claims}},"sitelinks":{${sitelinks}},"lastrevid":1,"modified":"2026-10-05T00:00:00Z"},`;
}

export const item = (id: number): Value => ({ item: id });
export const at = (latitude: number, longitude: number): Value => ({ latitude, longitude });
export const unknown: Value = { unknown: true };
