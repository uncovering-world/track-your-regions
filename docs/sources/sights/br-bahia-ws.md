---
slug: br-bahia-ws
name: Bahia.ws
publisher: "Bahia.ws, a guide to Salvador, Bahia and the Brazilian Northeast, online since 2009"
urls:
  home: https://bahia.ws/
  dataset: none
  api: none
  terms: https://bahia.ws/termos-e-condicoes-de-uso/
family: commercial
kinds: [beaches-and-swimming, places-of-worship, squares-and-streets, towns-and-villages, neighbourhoods, regional-food, palaces-and-castles, landmarks, history-museums, natural-landmarks, art-museums, festivals-and-events, specialty-museums, notable-people, markets, zoos-and-aquariums, public-art, traditional-arts-schools]
tier: regional
unit: { level: region, code: BR-BA, name: Bahia }
row:
  identity: "none seen: a place is named inside a guide article"
  wikidata_link: unknown
  coordinates: unknown
  languages: [pt, en, de, es, fr]
  signal: "being written up in one of its guide articles"
terms:
  licence: "none; Termos e Condições de Uso § 2: a copy for personal, non-commercial viewing only; no copying, no passing on, no mirroring"
  database_right: not-asserted
  attribution: Bahia.ws
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: no guide article was read for this record"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: unknown
  names: 2
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: unknown
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Bahia.ws

A guide to Salvador, Bahia and the Northeast, in Portuguese with English, German, Spanish and
French editions, begun in 2009 by its own account ("O Bahia.ws nasceu em 2009"); the survey
records it as edited in Bahia. Looked at on 2026-10-02 because the Salvador survey read it in
its second pass as a second guide written inside the country.

**What it sorts its places into.** Guide articles by theme and by place: tourist points of the
city, a quarter's guide, a seven-day itinerary, museums, churches, beaches near the city,
Carnaval, capoeira, the cuisine, and guides to the outings along the coast (the survey's
reading). The home page and the terms were what was read for this record, so what a row carries
is not known here.

**Terms ([the access table](../site-access.md), 2026-10-02).** `bahia.ws`: `allowed` (terms
silent on automated reading). `robots.txt`: open (`*`: `Allow: /`, WordPress service paths
disallowed). Signal: /llms.txt exists: "# Guia de Turismo do Nordeste e Brasil — Bahia, Salvador
e Mais \| Bahia\.ws: Guias de Turismo para a Bahia, Alagoas, Ceará e todo o Nordeste do Brasil:
praias,". Terms: silent on automated reading, at https://bahia.ws/termos-e-condicoes-de-uso/. A
licence clause forbids modifying or copying the materials, commercial use and mirroring; nothing
on automated access. The terms page, read for this record ("Última atualização: 05/08/2026"), §
2: "É concedida permissão para baixar temporariamente uma cópia dos materiais (informações ou
imagens) do site Bahia.ws, apenas para visualização pessoal e não comercial", and under that
licence "você não pode: modificar ou copiar os materiais; … transferir os materiais para
terceiros ou reproduzi-los (“espelhar”) em outro site ou servidor."

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because the coordinates were not looked at. The terms name no way to ask, only an address:
contato@bahia.ws.

**What the survey measured.** Eighteen pages read by fetch; its page of every beach of the city,
its page of every church and its article index were not counted, as directories. The Salvador
survey of 2026-10-02 counted it on 130 of the 196 entries of
`db/catalogue-coverage/expectations/salvador.jsonl` (by type: place 107, food 8, activity 7,
person 4, event 3, route 1). On 9 of them nothing else but the surveyor's own list names the
entry. The kinds in the front matter are those under which the survey filed two or more of the
entries it is named on.
