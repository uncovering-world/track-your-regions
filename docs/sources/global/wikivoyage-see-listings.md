---
slug: wikivoyage-see-listings
name: Wikivoyage, the places its articles list
publisher: Wikimedia Foundation and the Wikivoyage community
urls:
  home: https://en.wikivoyage.org/
  dataset: https://dumps.wikimedia.org/enwikivoyage/
  api: https://en.wikivoyage.org/w/api.php?action=parse&prop=wikitext&format=json&page=<title>
  terms: https://creativecommons.org/licenses/by-sa/3.0/
family: global
kinds: [any]
tier: regional
unit: { level: city, code: none, name: "the unit's article, or its district articles where the city is split" }
row:
  identity: "the listing's wikidata= parameter, where an editor set it"
  wikidata_link: itself
  coordinates: most
  languages: [all editions the dumps carry: 27 of 28 on 2026-10-20]
  signal: "a guide article uses the item: an editorial 'worth going to', in any section and any edition"
terms:
  licence: "CC BY-SA 3.0 (text)"
  database_right: not-asserted
  attribution: "Wikivoyage contributors, CC BY-SA 3.0 — the description is not copied; the name, coordinates and item are facts"
  scraping: not-needed
access:
  mode: dump
  format: "each edition's wbc_entity_usage and page SQL tables, gzip: the Wikidata items its articles use"
  cadence: "a dated run twice a month, every edition"
  volume: "27 editions' usage and page tables, about 58 MB together; 503,657 items on 2026-10-01 (English 134,320); per city: Florence 30 listings, Berlin/Mitte 71, Kraków/Old Town 43, Lima/Central Lima 99, Tbilisi 54, Tallinn 36, Tartu 28"
  rate: "the dumps host's: a few connections at a time"
scorecard:
  date: 2026-09-06
  completeness: 1
  identity: 1
  coordinates: 2
  names: 1
  signal: 1
  terms: 1
  access: 2
  cadence: 2
  total: 11
  verdict: adoptable
status: adopted
issue: 1768
looked_at: 2026-09-06
---

# Wikivoyage See listings

A city article's *See* section is an editorial list of what is worth seeing, each listing a
template with a name, coordinates and — where an editor added it — a Wikidata item. Looked at
on 2026-09-06 as the worked example of a global source with an editorial cut, read per unit
(`docs/tech/filling-a-kind.md` § 7.4).

**What was measured (2026-09-06).** See listings, with `wikidata=`, and museum-like by name:
Florence 30, 30, 22; Berlin/Mitte 71, 63, 32; Kraków/Old Town 43, 0, 9; Lima/Central Lima 99,
30, 45; Tbilisi 54, 36, 13; Tallinn 36, 4, 12; Tartu 28, 5, 6; the Paris city article 29
listings with one item — Paris, Berlin, Kraków and Lima are split into district articles, so
the unit is the set of them. Florence's listings carry the Uffizi (Q51252), the Bargello
(Q388448), the Accademia (Q10855544), Palazzo Pitti (Q29286) — the world tier's four — and
the Museo Stibbert (Q3329363, 11 sitelinks) beside them.

**What decides it.** A cut and a fallback where the item coverage is measured high (Florence,
Berlin/Mitte, Tbilisi), and neither where it is not (Kraków's Old Town: 43 listings, no
items). Coverage depends on which editor last walked the city. Share-alike on the text binds
what is copied, so the description is never stored — the name, the coordinates and the item
are facts, and the catalogue's own words are the catalogue's.

**Adopted as a witness of a place a visitor goes to (2026-10-20, #1768).** The maintainer decided
that day (#1718) that a place is one a visitor goes to when two independent witnesses of four say
so: a travel guide, photographs taken there, Wikidata's formal statements, and the map. This
source is the travel guide. Archaeology's source row (`experience_sources` id 5) is to read it
first, through its readership door (#1768).

It is read from every edition's dump: the `wikivoyage-usage` build keeps each Wikidata item a
guide article of an edition uses (`docs/tech/dumps.md` § The items Wikivoyage uses). An article
uses the item of a place it lists, in a See, Do, Eat or Sleep section alike, so no listing's text
is parsed or kept. A user's draft and a heritage register's lists are left out.

On the 150 judged places of #1718 and #1756, the usage tables give exactly what a parse of every
listing's `wikidata=` gives:
- 19 of dry run 178's 20 door sites (the Roman Baths, Karahan Tepe, Largo di Torre Argentina);
- none of its 9 places with nothing to see (Stapleton International Airport, Rungholt).

Every language counts. Largo di Torre Argentina is listed by German, Italian, English and Hebrew
Wikivoyage, and the Roman Baths by French Wikivoyage as well. As the guide alone it is not enough:
Italian Wikivoyage lists Rome so closely that it names the Regia and the Gardens of Sallust, where
nothing stands. That is why it is one witness of four.
