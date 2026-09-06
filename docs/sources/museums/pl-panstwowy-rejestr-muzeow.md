---
slug: pl-panstwowy-rejestr-muzeow
name: Państwowy Rejestr Muzeów (State Register of Museums)
publisher: Ministerstwo Kultury i Dziedzictwa Narodowego
urls:
  home: https://bip.mkidn.gov.pl/pages/rejestry-ewidencje-archiwa-wykazy/rejestry-muzeow.php
  dataset: https://dane.gov.pl/pl/dataset/4345,panstwowy-rejestr-muzeow
  api: https://api.dane.gov.pl/1.4/datasets/4345/resources
  terms: https://dane.gov.pl/pl/dataset/4345,panstwowy-rejestr-muzeow
family: registry
kinds: [art-museums, archaeology-museums, history-museums]
tier: regional
unit: { level: country, code: PL, name: Poland }
row:
  identity: "a running number (Lp.) and the name; no id of its own"
  wikidata_link: none
  coordinates: address-only
  languages: [pl]
  signal: "registration itself — the register admits a museum of 'a high level of merit' whose collections matter to Polish culture; an editorial cut by the state"
terms:
  licence: "CC0 1.0"
  database_right: waived
  attribution: "Ministerstwo Kultury i Dziedzictwa Narodowego, Państwowy Rejestr Muzeów, dane.gov.pl, file of 2026-01-16 (not required by CC0; given anyway)"
  scraping: not-needed
access:
  mode: dump
  format: xlsx
  cadence: "irregular ('nieregularnie'); files of 2024-07, 2024-10, 2026-01"
  volume: "136 rows, 30 kB"
  rate: none
scorecard:
  date: 2026-09-06
  completeness: 2
  identity: 1
  coordinates: 1
  names: 1
  signal: 1
  terms: 2
  access: 2
  cadence: 1
  total: 11
  verdict: adoptable
status: looked-at
issue: 799
looked_at: 2026-09-06
---

# Państwowy Rejestr Muzeów

The state register of museums kept by the Ministry of Culture and National Heritage under the
*ustawa o muzeach*, published on the national open-data portal. Looked at on 2026-09-06 as the
worked example of a register that is itself an editorial cut (`docs/tech/filling-a-kind.md`
§ 7.1).

**What was measured (2026-09-06).** The newest spreadsheet (2026-01-16, dated 9 January 2026
in its name) holds 135 museums, 12 of them with a date of removal from the register. Columns:
Lp., name, postal code, town, street type, street, building, unit, additional address,
organiser, date of entry, date of removal, remarks. No coordinates, no id beyond the running
number, no Wikidata. Kraków has nine rows, none removed: the National Museum in Kraków (1998),
Wawel Royal Castle — State Art Collection (1998), the Historical Museum of the City of Kraków
(2005), the Archaeological Museum (2006), the Polish Aviation Museum (2006), the Seweryn
Udziela Ethnographic Museum (2006), the Jagiellonian University Museum (2011), the Manggha
Museum of Japanese Art and Technology (2013), the Walery Rzewuski Museum of the History of
Photography (2014).

**Identity.** Matching the 135 names to Wikidata items is work done once; OpenStreetMap's
`wikidata` tags already cover five of Kraków's nine (the National Museum Q195311, Manggha
Q572206, the Aviation Museum Q377904, the Ethnographic Museum Q194616, the Jagiellonian
University Museum Q11787234). The Czartoryski Museum (Q1450630, tagged on OSM too) is not a
row of the register: it is a branch of the National Museum, and it is Kraków's world-tier
place — the register's National Museum row and the catalogue's Czartoryski row will meet as
two places, not one, which is a question for the merge rules (ADR-0046), not for the cut.

**Terms.** CC0 1.0 on dane.gov.pl; nothing is owed, attribution is given anyway.

**What decides it for the regional tier of art museums.** Registration is the cut: the
register lists 135 museums in a country where Wikidata holds 1,792 and Kraków alone has 116 on
Wikidata and 89 on OpenStreetMap. The place that shows it: Manggha — registered by the state
since 2013, 13 sitelinks, below any world line. The wider enumerations (the ministry's second
list, of museums with statutes agreed with the minister; the National Institute of Museums'
database) are the next candidates for the units the register leaves thin. Owed before
`evaluated`: the art museums among the 135, and the canon of Kraków art museums found and
missed.
