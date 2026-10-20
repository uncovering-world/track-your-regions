---
slug: wikivoyage-see-listings
name: Wikivoyage, the See listings of a unit's articles
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
  languages: [all 28 editions]
  signal: "being listed under See — an editorial 'worth seeing' by the guide's editors"
terms:
  licence: "CC BY-SA 3.0 (text)"
  database_right: not-asserted
  attribution: "Wikivoyage contributors, CC BY-SA 3.0 — the description is not copied; the name, coordinates and item are facts"
  scraping: not-needed
access:
  mode: dump
  format: "each edition's pages-articles XML, bzip2; the listing templates' wikidata= parameter"
  cadence: "a dated run twice a month, every edition"
  volume: "28 editions, about 400 MB together on 2026-10-20 (English 125 MB, German 69 MB); per city: Florence 30 listings, Berlin/Mitte 71, Kraków/Old Town 43, Lima/Central Lima 99, Tbilisi 54, Tallinn 36, Tartu 28"
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

**Adopted as the readership door's guard (2026-10-20, #1768, ADR-0128).** Archaeology's source
row (`experience_sources` id 5) reads it. The readership door opens for a site below the sitelinks
line only where a listing in any edition names its item. The listings are read from every
edition's `pages-articles` dump of one date by the `wikivoyage-listings` build
(`docs/tech/dumps.md` § Wikivoyage's listings), and only the item, the edition and the article
title are kept. Dry run 178's 41 door arrivals were measured that day:
- a listing names 19 of its 20 sites (the Roman Baths, Karahan Tepe, Largo di Torre Argentina);
- it names none of the 9 places with nothing to see (Stapleton International Airport, Rungholt)
  and neither of the 2 Roman predecessors of a living city.

Of the 510 Archaeology sites already admitted at 18–30 sitelinks, 75% are listed, so the listing
guards the door and never the line.
