---
slug: fr-merimee
name: Immeubles protégés au titre des Monuments historiques (the protected part of the Mérimée base)
publisher: Ministère de la Culture, Direction générale des patrimoines et de l'architecture (base Mérimée, published on data.gouv.fr)
urls:
  home: https://pop.culture.gouv.fr/
  dataset: https://www.data.gouv.fr/datasets/immeubles-proteges-au-titre-des-monuments-historiques-2
  api: https://ministere-culture.s3.sbg.io.cloud.ovh.net/POP/merimee.csv (the dump; a GeoJSON beside it)
  terms: https://github.com/etalab/Licence-Ouverte/blob/master/LO.md
family: registry
kinds: [places-of-worship, castles-and-fortresses, palaces-and-residences, historic-houses, architecture, monuments-and-memorials, archaeology, city-gates-and-walls]
tier: regional
unit: { level: country, code: FR, name: France }
row:
  identity: "the Mérimée reference (PA00088801); Wikidata links to it by P380, carried by 68,786 items in the dump of 2026-10-19, and 45,602 of the 46,761 protected rows' references are on an item (2026-10-25)"
  wikidata_link: P380
  coordinates: most
  languages: [fr]
  signal: "the protection itself and its grade: classé or inscrit, with the date and the parts protected"
terms:
  licence: "Licence Ouverte / Open Licence 2.0 (data.gouv.fr: lov2)"
  database_right: waived
  attribution: "Ministère de la Culture, base Mérimée, Immeubles protégés au titre des Monuments historiques, <date of the file>"
  scraping: not-needed
access:
  mode: dump
  format: "CSV separated by |, 100 MB (Reference, Denomination_de_l_edifice, Typologie_de_la_protection, Date_et_typologie_de_la_protection, coordonnees_au_format_WGS84, Commune, Departement, Historique …); a GeoJSON of 223 MB"
  cadence: weekly
  volume: "46,761 rows in the file of 2026-10-22"
  rate: none
scorecard:
  date: 2026-10-25
  completeness: 2
  identity: 2
  coordinates: 1
  names: 2
  signal: 1
  terms: 2
  access: 2
  cadence: 2
  total: 14
  verdict: adoptable
status: looked-at
issue: 1977
looked_at: 2026-10-25
---

# Mérimée, the protected historic monuments of France

The state's list of every building protected as a historic monument since 1840, from
prehistoric sites to 20th-century buildings. Each row comes from the decree and the protection
file of the Monuments historiques service. Looked at by #1977 as the example of a national
register that Wikidata already links to its items. It is a candidate list for the regional
tier of every kind of building or site in France.

**What was measured (2026-10-25).** The CSV of 2026-10-22 was downloaded once from the
dataset's own link and read whole:

- **Rows.** It holds 46,761 rows: 14,996 classé, 31,317 inscrit and 448 with another protection.
- **Coordinates.** 44,504 rows (95 %) carry a WGS84 point.
- **Wikidata.** 45,602 references appear as the first Mérimée ID (P380) of an item in the
  Wikidata dump of 2026-10-19. That is 97.5 % of the rows, and a floor, since an item's later
  values were not kept. Wikidata's P380 is carried by 68,786 items in all, because the base also
  holds the general inventory's records (IA…), which are not protections.

**The grade is a signal.** In Wikidata the grade sits on the item as a heritage designation
(P1435). Among places that carry a Mérimée ID:

| Grade | Places | Used by a Wikivoyage edition |
|---|---|---|
| classé | 16,781 | 14.4 % |
| inscrit | 36,416 | 4.8 % |
| listed in the general inventory | 18,943 | 1.3 % |

A classé building is about three times as likely as an inscrit one to be named by a guide.

**Terms.** data.gouv.fr gives the dataset the Licence Ouverte 2.0 (`lov2` on the dataset's API
record, read 2026-10-25). The licence's text (Etalab's `LO.md`, read the same day) lets the
reuser reproduce the information, adapt it "notamment pour créer des « Informations dérivées »"
and "l'exploiter à titre commercial, par exemple en la combinant avec d'autres informations",
on the condition of naming "sa source (a minima le nom du « Concédant »)" and "la date de la
dernière mise à jour". The texts of a notice carry a "© Monuments historiques" line, so the catalogue would
read the name, the protection, the date and the point, never the `Historique` prose.
`www.data.gouv.fr/robots.txt` closes only the search and admin paths. The file sits on the
ministry's object store and is a download, not a page.

**What it is for.** For France the register is the regional tier's list of the buildings and
sites the state protects, matched to items by the reference rather than by name. Its classé
grade is the within-country significance the world line's editions do not measure. A sync is
not written from this record by #1977; a kind's issue for France adopts it or not.
