---
slug: sn-au-senegal
name: "Au Sénégal, le cœur du Sénégal (au-senegal.com)"
publisher: "Imédia and Calao Production, two Senegalese companies (Dakar); online since April 2000"
urls:
  home: https://www.au-senegal.com/
  dataset: none
  api: none
  terms: https://www.au-senegal.com/auteurs-et-mentions-legales,1101.html
family: commercial
kinds: [regional-food, neighbourhoods, history-museums, regional-drinks, places-of-worship, art-museums, natural-landmarks, beaches-and-swimming, markets, festivals-and-events, palaces-and-castles, famous-peoples-places, towns-and-villages]
tier: regional
unit: { level: country, code: SN, name: Senegal }
row:
  identity: "the article number in the page's address (<slug>,<number>.html)"
  wikidata_link: none
  coordinates: some
  languages: [fr]
  signal: "being written up in its chapters and its 'incontournables'"
terms:
  licence: "the site's own reuse clause: all or part of the content may be reproduced with the source and its credit line, for personal, associative or professional use; commercial and advertising use excluded"
  database_right: not-asserted
  attribution: "© au-senegal.com - droits réservés"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "continuous: pages modified in September 2026"
  volume: unknown
  rate: "Crawl-delay: 1 (robots.txt)"
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 1
  coordinates: 1
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: 2
  total: 9
  verdict: adoptable-with-curator-pass
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Au Sénégal

A guide to Senegal in French, "le fruit d’une collaboration de deux sociétés sénégalaises",
Imédia (web and communication) and Calao Production (publisher of the country's tourist
directory), online since April 2000. Looked at on 2026-10-02 because the Dakar survey read it as
its guide written in Senegal.

**What it sorts its places into.** The menu: Se loger, Se déplacer, À faire, Art et culture,
Découvrir, Pratique, Actualités. Découvrir holds the natural regions and guided visits; the site
also has an interactive map whose points are, in its own words, "hébergement, art et culture,
parcs naturels, musées, monuments historiques, marchés, voyage et transport", fed by a map
endpoint of the site that was not read. Every article has a number in its address
(`<slug>,<number>.html`).

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.au-senegal.com`: `allowed`
(legal notice allows reproduction with attribution, non-commercial; crawl delay of 1).
`robots.txt`: open (`*`: SPIP service paths, and `Crawl-delay: 1`). Terms: allow reuse, at
https://www.au-senegal.com/auteurs-et-mentions-legales,1101.html. Nothing on robots, automated
collection, mining or AI. The clause, as the table has it: "À l’exception du logo et de
l’iconographie, la reproduction de tout ou partie du contenu de ce site est autorisée sous
réserve de l’ajout de façon claire et lisible de la source et de la mention suivante : « ©
au-senegal.com - droits réservés ». Les informations utilisées ne doivent l’être qu’à des fins
personnelles, associatives ou professionnelles ; toute utilisation à des fins commerciales ou
publicitaires est exclue."

**What decides it.** The total is 9 and the verdict `adoptable-with-curator-pass`, where the
rules send every other private site read for the surveys of 2026-10-02 that could be scored to
`curator-list` or `veto`: it has a number per article and a licence to reuse with the source,
for uses that are not commercial, which is what the product is (`docs/tech/filling-a-kind.md` §
5). § 7.5 of the same doc says no to commercial guides as sources because their terms forbid
storing and they have no data interface; this one's terms allow reuse with the source, and it
gives each article a number, so the scorecard decides it like any other source. The licence
leaves out the pictures, which the catalogue would not take anyway. What is owed before anyone
leans on that verdict: whether the article numbers are stable, and what share of its places
carry a point on the map. The address to write to is its contact page
(`ecrire-au-webmaster,1690.html`); the legal page gives Imédia, 34 Mermoz Pyrotechnie, BP 10422
Dakar Liberté.

**What the survey measured.** It could be read: "Les incontournables à visiter à Dakar", the
festivals article, the index of rites and traditions, two regional chapters, two articles on
cuisine and drinks and one on museums. In the second pass nine counts taken from its directory
of places of interest were withdrawn, a directory being no recommendation, and six from searches
that carried a name. The Dakar survey of 2026-10-02 counted it on 49 of the 110 entries of
`db/catalogue-coverage/expectations/dakar.jsonl` (by type: place 34, food 8, drink 5, event 2).
On 5 of them nothing else but the surveyor's own list names the entry. The kinds in the front
matter are those under which the survey filed two or more of the entries it is named on.
