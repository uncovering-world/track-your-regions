---
slug: id-kompas-travel
name: "Kompas Travel"
publisher: "PT. Kompas Cyber Media (Kompas Gramedia Digital Group)"
urls:
  home: https://travel.kompas.com/
  dataset: none
  api: none
  terms: https://inside.kompas.com/term-of-use
family: commercial
kinds: [unknown]
tier: none
unit: { level: country, code: ID, name: Indonesia }
row:
  identity: unknown
  wikidata_link: unknown
  coordinates: unknown
  languages: [id]
  signal: unknown
terms:
  licence: "none; Terms of Use: no AI use of the content, retrieval included, and no automated collection"
  database_right: not-asserted
  attribution: unknown
  scraping: reserved
access:
  mode: scrape
  format: html
  cadence: "continuous: a daily news site, by its own account; no article was read for this record"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: unknown
  identity: unknown
  coordinates: unknown
  names: unknown
  signal: unknown
  terms: 0
  access: unknown
  cadence: 2
  total: unknown
  verdict: veto
status: refused
issue: 1213
looked_at: 2026-10-02
---

# Kompas Travel

The travel section of an Indonesian news site. Looked at on 2026-10-02 because the Bali survey
met 403 on the first article it fetched and left it alone.

**Terms ([the access table](../site-access.md), 2026-10-02).** `travel.kompas.com`: `refused`
(`robots.txt` disallows Anthropic agents). `robots.txt`: disallows Anthropic agents (The file
opens: "# Use of any device, tool, or process designed to data mine or scrape the content using
automated means is prohibited without prior written permission from PT. Kompas Cyber Media.
Prohibited uses include but are not limited to: (1) text and data mining activities; (2) the
development of any software, machine learning, artificial intelligence (AI), and/or large
language models (LLMs); […]"). Signal: robots.txt comment: "# Use of any device, tool, or
process designed to data mine or scrape the content using automated means is prohibited without
prior written permission from PT. Kompas Cyber Media. Prohibited uses include but are not
limited to: (1) text and data mining activities; (2) the development of any software, machine
learning, artificial intelligence (AI), and/or large language models (LLMs); (3) creating or
providing archived or cached data sets containing our content to others; and/or (4) any
commercial purposes.". Terms: bar automated access, bar mining, bar use by or for AI, at
https://inside.kompas.com/term-of-use. AI use is barred for training, grounding and retrieval
alike. The page adds that robots.txt is not written consent. The clause, as the table has it:
"Menggunakan Konten, Produk, Data atau Informasi dari Layanan yang disediakan untuk pengembangan
program perangkat lunak, model, algoritma, atau alat kecerdasan buatan ( Artificial
Intelligence/AI ) atau Artificial Intelligence/AI generatif, termasuk namun tidak terbatas pada
pelatihan, penyempurnaan ( fine-tuning ), grounding , atau pengoperasian sistem pembelajaran
mesin/ Artificial Intelligence/AI , maupun penggunaan Konten, Produk, Data atau Informasi
sebagai bagian dari mekanisme retrieval-augmented generation ; Menggunakan robot, spider, skrip,
layanan, perangkat lunak, atau perangkat baik manual maupun otomatis lainnya yang dirancang
untuk melakukan penggalian atau pengambilan data atas Konten, Produk, Data, atau Informasi dari
Layanan yang disediakan, atau menggunakan, mengakses, maupun mengumpulkan Konten, Produk, Data,
atau Informasi dari Layanan melalui cara otomatis lainnya;" For this record the front page was
fetched with `curl` and answered 200 before the notice in `robots.txt` was read; nothing more
was fetched.

**What decides it.** The access table: `refused`. Its `robots.txt` disallows every agent of the
survey's model by name and opens with a notice that reserves mining, AI use and cached data
sets; its Terms of Use bar AI use, retrieval included, and add that `robots.txt` is not written
consent. Terms 0: the verdict is `veto` and the status `refused`. The notice gives
`https://inside.kompas.com/about-us#meet` for asking.

**What the survey measured.** Nothing. The Bali survey met 403 on the first article it fetched
and left the site alone; nothing from the search that found it was used. Nothing of it counts,
and this record carries no figure.
