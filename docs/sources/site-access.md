# Which sites may be read

One line per site a catalogue-coverage survey has looked at, with whether it may be read and
why. A survey looks a site up here before it opens a page of it and takes the verdict it finds.
A site the table does not hold is judged by the rules in
[`/coverage-survey`](../../.claude/skills/coverage-survey/SKILL.md) § Ground rules, and the
survey adds its line, with the date it read the site, in the same change as its list. A site
whose publisher has since opened or closed it is judged again and its line replaced.

A **refused** site counts for nothing: no page of it is read, and a search result on it is not a
reading of it. An **allowed** site may carry a condition: *a few pages, one at a time* where the
terms limit the rate of requests or bar copying in bulk by script; *through the API, one request
at a time* for Wikivoyage, which the `lookup` command reads; *closed paths not read* where
`robots.txt` closes some paths to every agent, so a count that rests on such a page is not
taken. A `robots.txt` that is *none* (the address answers 404) or *unavailable* (lost in a
redirect loop) allows; one that is *unreachable* (a timeout, a failed certificate, a server
error) refuses (RFC 9309 § 2.3.1). Terms *not read* means the terms page could not be fetched; a
clause seen only in a search result is not a reading, and the site is judged on its `robots.txt`
alone.

Each country edition of a guide is its own publisher's site and has its own line. The terms
column links the page the verdict was read on. The records of the sources these sites belong to
are under [`sights/`](sights/), where a source the surveys counted has its terms quoted.

| Site | Publisher | `robots.txt` | Terms | Verdict | What decides it | Read |
|---|---|---|---|---|---|---|
| `www.101viajes.com` | RUBCLICK S.L. | some paths closed | [silent on automated reading](https://www.101viajes.com/Aviso-Legal) | allowed | closed paths not read | 2026-10-02 |
| `www.aa.co.nz` | The New Zealand Automobile Association (Incorporated) | open | [silent on automated reading](https://www.aa.co.nz/site-info/terms-and-conditions/website/) | allowed | — | 2026-10-02 |
| `www.adac.de` | Allgemeiner Deutscher Automobil-Club e.V. (ADAC) | open | [silent on automated reading](https://www.adac.de/impressum-ev/) | allowed | — | 2026-10-02 |
| `www.afar.com` | Afar LLC | some paths closed | [bar automated access, bar mining, bar AI use](https://www.afar.com/about/terms-of-service) | refused | terms bar use by or for AI | 2026-10-02 |
| `www.andina.pe` | Editora Perú (Agencia Andina) | open | [silent on automated reading](https://andina.pe/agencia/legal/andinatyc.html) | allowed | — | 2026-10-02 |
| `armenia.travel` | Tourism Committee of the Ministry of Economy of the Republic of Armenia | some paths closed | [bar automated access, bar mining](https://armenia.travel/privacy-policy/) | refused | terms bar robots, automated access or mining, with no leave for an AI agent | 2026-10-02 |
| `www.atlasobscura.com` | Atlas Obscura | open | [not read](https://www.atlasobscura.com/terms) | allowed | — | 2026-10-02 |
| `www.au-senegal.com` | Imédia & Calao Production (au-senegal.com) | open | [allow](https://www.au-senegal.com/auteurs-et-mentions-legales,1101.html) | allowed | — | 2026-10-02 |
| `www.aucklandnz.com` | Tātaki Auckland Unlimited (Auckland Council) | open | [allow](https://aucklandunlimited.com/terms-conditions) | allowed | — | 2026-10-02 |
| `www.australia.com` | Tourism Australia | some paths closed | [silent on automated reading](https://www.australia.com/en/terms-and-conditions.html) | allowed | closed paths not read | 2026-10-02 |
| `www.australiantraveller.com` | Australian Traveller Media Pty Ltd | some paths closed | [bar automated access](https://www.australiantraveller.com/terms-of-use/) | refused | terms bar robots, automated access or mining, with no leave for an AI agent | 2026-10-02 |
| `www.aviasales.ru` | Go Travel Un Limited, Hong Kong (Авиасейлс) | some paths closed | [bar automated access](https://www.aviasales.ru/terms-of-use) | refused | terms bar robots, automated access or mining, with no leave for an AI agent | 2026-10-02 |
| `bahia.ws` | Bahia.ws | open | [silent on automated reading](https://bahia.ws/termos-e-condicoes-de-uso/) | allowed | — | 2026-10-02 |
| `www.bluemts.com.au` | Stralia Web | open | [silent on automated reading](https://www.bluemts.com.au/disclaimer/) | allowed | — | 2026-10-02 |
| `www.bradtguides.com` | Bradt Travel Guides | open | [bar automated access, bar mining](https://www.bradtguides.com/terms-conditions/) | refused | terms bar robots, automated access or mining, with no leave for an AI agent | 2026-10-02 |
| `www.broadsheet.com.au` | Broadsheet Media Pty Ltd | disallows Anthropic agents | [bar automated access, bar mining, bar AI use](https://www.broadsheet.com.au/national/info/terms-of-use) | refused | `robots.txt` disallows Anthropic agents | 2026-10-02 |
| `caravanistan.com` | Alma Media BV, Belgium (Caravanistan) | unavailable | [allow](https://caravanistan.com/terms-conditions/) | allowed | `robots.txt` redirects in a loop, which is an unavailable file (RFC 9309 § 2.3.1.2) and allows; terms allow, content CC BY-SA | 2026-10-02 |
| `www.chilango.com` | Capital Digital, S.A.P.I. de C.V. (Chilango) | open | [bar automated access, bar mining, bar AI use](https://www.chilango.com/terminos-condiciones-uso-del-sitio-web-www-chilango-com/) | refused | terms bar use by or for AI | 2026-10-02 |
| `www.chinahighlights.com` | Highlights Travel Co., Ltd. | some paths closed | [silent on automated reading](https://www.chinahighlights.com/aboutus/terms.htm) | allowed | closed paths not read | 2026-10-02 |
| `www.cityofsydney.nsw.gov.au` | The Council of the City of Sydney | open | [bar automated access](https://www.cityofsydney.nsw.gov.au/terms-conditions) | refused | terms bar robots, automated access or mining, with no leave for an AI agent | 2026-10-02 |
| `www.cntraveler.com` | Condé Nast | disallows Anthropic agents | [not read](https://www.condenast.com/user-agreement/) | refused | `robots.txt` disallows Anthropic agents | 2026-10-02 |
| `concreteplayground.com` | Concrete Playground | open | no terms page linked | allowed | — | 2026-10-02 |
| `cosituc.gob.pe` | COSITUC (Boleto Turístico del Cusco) | open | not read | allowed | — | 2026-10-02 |
| `www.cuba.travel` | Ministerio de Turismo de Cuba (portal Cuba Travel) | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.cuscoperu.com` | Cuscoperu.com E-Commerce E.I.R.L | allows Anthropic agents by name | [silent on automated reading](https://www.cuscoperu.com/es/terminos-y-condiciones/) | allowed | — | 2026-10-02 |
| `de.wikivoyage.org` | Wikimedia Foundation (Wikivoyage, content under CC BY-SA 4.0) | some paths closed | [allow, limit the rate](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use) | allowed | through the API, one request at a time; closed paths not read | 2026-10-02 |
| `delhitourism.gov.in` | Delhi Tourism and Transportation Development Corporation (DTTDC) | none | [silent on automated reading](https://delhitourism.gov.in/dttdc/website-policy.html) | allowed | — | 2026-10-02 |
| `www.detik.com` | detikcom | open | [allow](https://www.detik.com/copyright) | allowed | — | 2026-10-02 |
| `disparda.baliprov.go.id` | Pemerintah Provinsi Bali (Dinas Pariwisata) | open | no terms page linked | allowed | — | 2026-10-02 |
| `dk.com` | Dorling Kindersley Limited (DK), a Shopify storefront | open | [silent on automated reading](https://dk.com/pages/terms-and-conditions) | allowed | — | 2026-10-02 |
| `www.dondeir.com` | Dónde Ir (Grupo Medios) | open | no terms page linked | allowed | — | 2026-10-02 |
| `elcomercio.pe` | Empresa Editora El Comercio S.A. | some paths closed | [silent on automated reading](https://elcomercio.pe/terminos-y-condiciones/) | allowed | closed paths not read | 2026-10-02 |
| `elpais.com` | Ediciones El País (PRISA) | disallows Anthropic agents | not read | refused | `robots.txt` disallows Anthropic agents | 2026-10-02 |
| `en.wikivoyage.org` | Wikimedia Foundation (Wikivoyage, content under CC BY-SA 4.0) | some paths closed | [allow, limit the rate](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use) | allowed | through the API, one request at a time; closed paths not read | 2026-10-02 |
| `english.visitbeijing.com.cn` | Beijing Municipal Bureau of Culture and Tourism | disallows every agent | no terms page linked | refused | `robots.txt` disallows every agent | 2026-10-02 |
| `www.enperu.org` | Enperu | open | no terms page linked | allowed | — | 2026-10-02 |
| `escapadas.mexicodesconocido.com.mx` | México Desconocido (g21 Comunicación) | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.excelenciascuba.com` | Grupo Excelencias (Caribe News Digital) | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.experienceegypt.eg` | Egyptian Tourism Authority (Experience Egypt) | open | no terms page linked | allowed | — | 2026-10-02 |
| `fa.wikivoyage.org` | Wikimedia Foundation (Wikivoyage, content under CC BY-SA 4.0) | some paths closed | [allow, limit the rate](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use) | allowed | through the API, one request at a time; closed paths not read | 2026-10-02 |
| `www.flypgs.com` | Pegasus Hava Taşımacılığı A.Ş. (Pegasus Airlines) | open | not read | allowed | — | 2026-10-02 |
| `www.fodors.com` | — | answers a challenge | not read | refused | answers 403 or a challenge page | 2026-10-02 |
| `www.frommers.com` | FrommerMedia LLC | open | [not read](https://www.frommers.com/about/terms-of-service) | refused | pages answer 403 to the fetch tool | 2026-10-02 |
| `www.gazeta.uz` | ООО «Gazeta News» | open | [silent on automated reading](https://www.gazeta.uz/ru/terms/) | allowed | — | 2026-10-02 |
| `www.gob.mx` | Gobierno de México | open | [silent on automated reading](https://www.gob.mx/terminos) | allowed | — | 2026-10-02 |
| `www.gob.pe` | Estado Peruano (gob.pe) | open | no terms page linked | allowed | — | 2026-10-02 |
| `goturkiye.com` | Türkiye Tourism Promotion and Development Agency (TGA) | allows Anthropic agents by name | no terms page linked | refused | answered a 403 challenge page to the fetch tool | 2026-10-02 |
| `guia.melhoresdestinos.com.br` | Melhores Destinos | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.guiarepsol.com` | Repsol (Guía Repsol) | open | [silent on automated reading](https://www.guiarepsol.com/es/condiciones-de-servicio/) | allowed | — | 2026-10-02 |
| `guias-viajar.com` | Guías Viajar S.L. | open | [silent on automated reading](https://guias-viajar.com/aviso-legal-politica-cookies/) | allowed | — | 2026-10-02 |
| `hi.wikivoyage.org` | Wikimedia Foundation (Wikivoyage, content under CC BY-SA 4.0) | some paths closed | [allow, limit the rate](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use) | allowed | through the API, one request at a time; closed paths not read | 2026-10-02 |
| `ich.unesco.org` | UNESCO (Intangible Cultural Heritage) | open | [bar mining, bar automated access, bar AI use, allow](https://www.unesco.org/en/terms-use) | allowed | UNESCO's terms: they reserve mining and expressly permit an AI system retrieving single pages to answer a query, naming UNESCO | 2026-10-02 |
| `id.wikivoyage.org` | Wikimedia Foundation (Wikivoyage, content under CC BY-SA 4.0) | some paths closed | [allow, limit the rate](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use) | allowed | through the API, one request at a time; closed paths not read | 2026-10-02 |
| `www.incredibleindia.gov.in` | Ministry of Tourism, Government of India | open | [silent on automated reading](https://www.incredibleindia.gov.in/en/terms-of-use) | allowed | — | 2026-10-02 |
| `www.indonesia.travel` | Ministry of Tourism of the Republic of Indonesia | open | [bar automated access](https://www.indonesia.travel/gb-en/terms-conditions/) | refused | terms bar robots, automated access or mining, with no leave for an AI agent | 2026-10-02 |
| `www.insightguides.com` | Apa Digital AG (Insight Guides) | some paths closed | [not read](https://www.insightguides.com/static_page/insight-guides-terms-conditions) | allowed | closed paths not read | 2026-10-02 |
| `inviaggio.touringclub.it` | Fondazione Touring Club Italiano | open | [silent on automated reading](https://www.touringclub.it/termini-e-condizioni) | allowed | — | 2026-10-02 |
| `it.wikivoyage.org` | Wikimedia Foundation (Wikivoyage, content under CC BY-SA 4.0) | some paths closed | [allow, limit the rate](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use) | allowed | through the API, one request at a time; closed paths not read | 2026-10-02 |
| `www.italia.it` | Ministero del Turismo (MiTur), Italia.it | open | [silent on automated reading](https://www.italia.it/it/termini-e-condizioni) | allowed | — | 2026-10-02 |
| `itto.org` | Iran Travel, Tourism and Touring Online NGO | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.iwanowski.de` | Iwanowski's Reisebuchverlag GmbH | some paths closed | [silent on automated reading](https://www.iwanowski.de/impressum/) | allowed | closed paths not read | 2026-10-02 |
| `www.japan-guide.com` | japan-guide.com | some paths closed | [silent on automated reading](https://www.japan-guide.com/e/e441.html) | allowed | closed paths not read | 2026-10-02 |
| `www.japan.travel` | Japan National Tourism Organization (JNTO) | some paths closed | [silent on automated reading](https://www.japan.travel/en/terms-of-use/) | allowed | closed paths not read | 2026-10-02 |
| `www.kojaro.com` | کجارو (Kojaro) | open | no terms page linked | allowed | — | 2026-10-02 |
| `kyoto.travel` | City of Kyoto and Kyoto City Tourism Association | open | [silent on automated reading](https://kyoto.travel/en/privacy-policy) | allowed | — | 2026-10-02 |
| `www.kyototourism.org` | Kyoto Prefecture ("Another Kyoto") | open | [silent on automated reading](https://www.kyototourism.org/en/privacy/) | allowed | — | 2026-10-02 |
| `lahabana.com` | — | unreachable | not read | refused | `robots.txt` unreachable, read as a complete disallow (RFC 9309 § 2.3.1.4) | 2026-10-02 |
| `lastsecond.ir` | لست‌سکند (LastSecond) | some paths closed | no terms page linked | allowed | closed paths not read | 2026-10-02 |
| `www.local.mx` | Local MX | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.localguidetoegypt.com` | The Local's Guide To Egypt | open | [silent on automated reading](https://www.localguidetoegypt.com/privacy-policy) | allowed | — | 2026-10-02 |
| `www.lonelyplanet.com` | Lonely Planet, a Red Ventures company (home page footer) | some paths closed | [bar mining, bar automated access](https://www.lonelyplanet.com/legal/website-terms) | refused | terms prohibit text-and-data mining, and "You may not copy, store, scrape or use any part of our site without permission" | 2026-10-02 |
| `www.lonelyplanet.de` | MAIRDUMONT GmbH & Co. KG (German edition) | disallows Anthropic agents | [bar mining, bar AI use](https://www.lonelyplanet.de/impressum) | refused | `robots.txt` disallows Anthropic agents | 2026-10-02 |
| `www.lonelyplanet.es` | Editorial Planeta, S.A.U. (geoPlaneta), Spanish edition | allows Anthropic agents by name | [silent on automated reading](https://www.lonelyplanet.es/condiciones-de-uso-de-la-web) | allowed | — | 2026-10-02 |
| `www.lonelyplanet.fr` | EDI8 (Place des éditeurs), exclusive licensee of Lonely Planet Global Limited for French | some paths closed | [bar mining, bar AI use](https://www.lonelyplanet.fr/conditions-generales-dutilisation) | refused | terms bar use by or for AI | 2026-10-02 |
| `www.lonelyplanetitalia.it` | EDT srl (Italian edition; footer: "© 2026 Lonely Planet, a Red Ventures company") | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.mapple.net` | 株式会社昭文社 (Shobunsha), まっぷるウェブ | open | [silent on automated reading](https://www.mapple.net/term/) | allowed | — | 2026-10-02 |
| `www.marcopolo.de` | MAIRDUMONT GmbH & Co. KG (Marco Polo) | disallows Anthropic agents | [silent on automated reading](https://www.marcopolo.de/impressum) | refused | `robots.txt` disallows Anthropic agents | 2026-10-02 |
| `media.lonelyplanet.com` | Lonely Planet (file store on Amazon S3) | none | no terms page linked | refused | Lonely Planet's file store: its chapter previews are the publisher's content under the same terms as www.lonelyplanet.com, and the files carry a no-copy flag | 2026-10-02 |
| `www.melhoresdestinos.com.br` | Melhores Destinos | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.merian.de` | Jahreszeiten Verlag GmbH (Merian) | allows Anthropic agents by name | [silent on automated reading](https://www.merian.de/impressum) | allowed | — | 2026-10-02 |
| `mexicocity.cdmx.gob.mx` | Gobierno de la Ciudad de México | open | [silent on automated reading](https://mexicocity.cdmx.gob.mx/terms-of-use/) | allowed | — | 2026-10-02 |
| `www.mexicodesconocido.com.mx` | México Desconocido (g21 Comunicación) | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.moon.com` | not Moon Travel Guides: moon.com is a betting-markets site ("Moon.com: Betting Markets") | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.moontravelguides.com` | Hachette Book Group, Inc. (Moon Travel Guides) | open | [bar automated access](https://www.hachettebookgroup.com/terms-and-policies/terms-of-use/) | refused | terms bar robots, automated access or mining, with no leave for an AI agent | 2026-10-02 |
| `www.nationalgeographic.com` | National Geographic Partners (The Walt Disney Company) | some paths closed | [bar automated access, bar mining, bar AI use](https://disneytermsofuse.com/english/) | refused | terms bar use by or for AI | 2026-10-02 |
| `www.nationalparks.nsw.gov.au` | State of New South Wales, Department of Climate Change, Energy, the Environment and Water | some paths closed | [allow](https://www.nationalparks.nsw.gov.au/copyright-disclaimer) | allowed | closed paths not read | 2026-10-02 |
| `news.cityofsydney.nsw.gov.au` | The Council of the City of Sydney | open | [bar automated access](https://www.cityofsydney.nsw.gov.au/terms-conditions) | refused | terms bar robots, automated access or mining, with no leave for an AI agent | 2026-10-02 |
| `peru.info` | PromPerú (Marca Perú) | open | [silent on automated reading](https://peru.info/es-pe/terminos-y-condiciones) | allowed | — | 2026-10-02 |
| `www.peru.travel` | PromPerú (Comisión de Promoción del Perú para la Exportación y el Turismo) | open | [silent on automated reading](https://www.peru.travel/en/terms-and-conditions) | allowed | — | 2026-10-02 |
| `www.petitfute.com` | — | some paths closed | no terms page linked | refused | pages answer 403 to the fetch tool | 2026-10-02 |
| `r.visitbeijing.com.cn` | Beijing Municipal Bureau of Culture and Tourism | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.reise-know-how.de` | Reise Know-How Verlag Peter Rump GmbH | open | [silent on automated reading](https://www.reise-know-how.de/de/impressum) | allowed | — | 2026-10-02 |
| `www.ricksteves.com` | Rick Steves' Europe, Inc. | some paths closed | [bar automated access](https://www.ricksteves.com/about-us/terms-of-service) | refused | terms bar robots, automated access or mining, with no leave for an AI agent | 2026-10-02 |
| `www.roughguides.com` | Apa Digital AG (Rough Guides) | some paths closed | [limit the rate](https://www.roughguides.com/terms-conditions/) | allowed | a few pages, one at a time; closed paths not read | 2026-10-02 |
| `www.routard.com` | Cyberterre SCS (Hachette), Le Routard | allows Anthropic agents by name | [bar automated access, bar mining](https://www.routard.com/fr/pages/cgu) | allowed | terms bar extraction "sauf autorisation de l'Editeur"; `robots.txt` names `anthropic-ai` and `ClaudeBot` with `Allow: /` under "Allow AI search and agent use", which is that leave | 2026-10-02 |
| `ru.wikivoyage.org` | Wikimedia Foundation (Wikivoyage, content under CC BY-SA 4.0) | some paths closed | [allow, limit the rate](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use) | allowed | through the API, one request at a time; closed paths not read | 2026-10-02 |
| `www.rumbosdelperu.com` | Rumbos de Sol & Piedra | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.salvadordabahia.com` | Prefeitura de Salvador (portal oficial de turismo) | open | [not read](https://www.salvadordabahia.com/wp-content/uploads/2019/02/termo-de-uso_salvadordabahia.pdf) | allowed | — | 2026-10-02 |
| `samokatus.ru` | ООО «Самокатус» | some paths closed | [silent on automated reading](https://samokatus.ru/policy) | allowed | closed paths not read | 2026-10-02 |
| `shop.roughguides.com` | Apa Publications UK Ltd / Apa Digital AG (Rough Guides bookshop) | open | [silent on automated reading](https://www.roughguides.com/bookshop/terms-and-conditions/) | allowed | — | 2026-10-02 |
| `www.smh.com.au` | Nine Entertainment Co. (The Sydney Morning Herald; Traveller lives under /traveller) | disallows Anthropic agents | [not read](https://login.nine.com.au/terms?client_id=smh) | refused | `robots.txt` disallows Anthropic agents | 2026-10-02 |
| `surfiran.com` | SURFIRAN Tour and Travel | open | [silent on automated reading](https://surfiran.com/terms-conditions/) | allowed | — | 2026-10-02 |
| `www.sydney.com` | Destination NSW | open | [silent on automated reading](https://www.sydney.com/terms-of-use) | allowed | — | 2026-10-02 |
| `theculturetrip.com` | Culture Trip | disallows Anthropic agents | not read | refused | `robots.txt` disallows Anthropic agents | 2026-10-02 |
| `www.theurbanlist.com` | LABORE Pty Ltd (Urban List) | open | [not read](https://www.theurbanlist.com/terms) | allowed | — | 2026-10-02 |
| `www.timeout.com` | Time Out England Limited and Time Out Market Limited (Time Out Group Plc) | open | [bar AI use](https://www.timeout.com/terms-of-use) | refused | terms bar use by or for AI | 2026-10-02 |
| `www.timeoutmexico.mx` | Time Out (footer: "© 2026 Time Out England Limited and affiliated companies owned by Time Out Group Plc") | open | [bar AI use](https://www.timeout.com/terms-of-use) | refused | terms bar use by or for AI | 2026-10-02 |
| `tonkosti.ru` | ООО «Тонкости продаж» (Тонкости туризма) | open | [silent on automated reading](https://tonkosti.ru/Авторские_права) | allowed | — | 2026-10-02 |
| `www.touringclub.it` | Fondazione Touring Club Italiano | open | [silent on automated reading](https://www.touringclub.it/termini-e-condizioni) | allowed | — | 2026-10-02 |
| `tourisme-dakar.com` | tourisme-dakar (publisher not named) | open | no terms page linked | allowed | — | 2026-10-02 |
| `travel.detik.com` | detikcom | open | [allow](https://www.detik.com/copyright) | allowed | — | 2026-10-02 |
| `travel.kompas.com` | PT. Kompas Cyber Media | disallows Anthropic agents | [bar automated access, bar mining, bar AI use](https://inside.kompas.com/term-of-use) | refused | `robots.txt` disallows Anthropic agents | 2026-10-02 |
| `www.travel365.it` | Emade srl | some paths closed | [silent on automated reading](https://www.travel365.it/privacy.htm) | allowed | closed paths not read | 2026-10-02 |
| `www.travelchinaguide.com` | TravelChinaGuide (no legal entity named on the page) | open | [silent on automated reading](https://www.travelchinaguide.com/tour/terms.htm) | allowed | — | 2026-10-02 |
| `www.traveler.es` | Condé Nast (Traveler España) | disallows Anthropic agents | [not read](https://www.traveler.es/info/condiciones-de-uso) | refused | `robots.txt` disallows Anthropic agents | 2026-10-02 |
| `www.traveller.com.au` | Nine Entertainment Co. (Traveller, served at www.smh.com.au/traveller) | none | [not read](https://login.nine.com.au/terms?client_id=smh) | refused | every page redirects to www.smh.com.au/traveller, whose robots.txt disallows Anthropic agents | 2026-10-02 |
| `www.travesiasdigital.com` | Capital Digital Media, S.A. de C.V. (Travesías) | open | [bar automated access, bar mining, bar AI use](https://www.travesiasdigital.com/terminos-y-condiciones-de-uso/) | refused | terms bar use by or for AI | 2026-10-02 |
| `turismoi.pe` | Turismoi | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.turismoroma.it` | Roma Capitale, Dipartimento Grandi Eventi, Sport, Turismo e Moda | open | [silent on automated reading](https://www.turismoroma.it/it/page/copyright) | allowed | — | 2026-10-02 |
| `www.unesco.org` | UNESCO | disallows Anthropic agents | [bar mining, bar automated access, bar AI use, allow](https://www.unesco.org/en/terms-use) | refused | `robots.txt` disallows Anthropic agents | 2026-10-02 |
| `uzbekistan.travel` | ГУ «Национальный PR-центр» (National PR Centre), Uzbekistan | none | [bar mass copying by script](https://uzbekistan.travel/ru/polzovatelskoe-soglashenie/) | allowed | the user agreement bars "automated scripts for mass copying of materials", which a few pages read for names is not; a few pages, one at a time | 2026-10-02 |
| `www.viajeros.com` | — | none | not read | allowed | — | 2026-10-02 |
| `www.viajeroscallejeros.com` | Viajeros Callejeros 2021 SL | open | [silent on automated reading](https://www.viajeroscallejeros.com/aviso-legal/) | allowed | — | 2026-10-02 |
| `viajes.nationalgeographic.com.es` | — | answers a challenge | not read | refused | answers 403 or a challenge page | 2026-10-02 |
| `www.viamichelin.com` | Manufacture Française des Pneumatiques Michelin (ViaMichelin) | allows Anthropic agents by name | [bar automated access](https://www.viamichelin.com/magazine/general-terms-and-conditions-of-use/) | refused | terms bar robots, automated access or mining, with no leave for an AI agent | 2026-10-02 |
| `www.viamichelin.fr` | Manufacture Française des Pneumatiques Michelin (ViaMichelin) | allows Anthropic agents by name | [bar automated access](https://www.viamichelin.fr/magazine/conditions-generales-dutilisation/) | refused | terms bar robots, automated access or mining, with no leave for an AI agent | 2026-10-02 |
| `visit.istanbul` | İstanbul Büyükşehir Belediyesi | none | no terms page linked | allowed | — | 2026-10-02 |
| `www.visitbluemountains.com.au` | Blue Mountains Tourism | open | no terms page linked | allowed | — | 2026-10-02 |
| `visitethiopia.et` | Ethiopian Tourism (Visit Ethiopia) | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.visitezlesenegal.com` | Agence Sénégalaise de Promotion Touristique | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.visitiran.ir` | Ministry of Cultural Heritage, Tourism and Handicrafts of Iran | open | no terms page linked | allowed | — | 2026-10-02 |
| `www.visitnsw.com` | Destination NSW | open | [silent on automated reading](https://www.visitnsw.com/terms-of-use) | allowed | — | 2026-10-02 |
| `visityerevan.am` | Yerevan Municipality | none | [silent on automated reading](https://visityerevan.am/terms-of-use/en/) | allowed | — | 2026-10-02 |
| `web.cusco.gob.pe` | Municipalidad del Cusco | some paths closed | no terms page linked | allowed | closed paths not read | 2026-10-02 |
| `whatson.cityofsydney.nsw.gov.au` | The Council of the City of Sydney | open | [bar automated access](https://whatson.cityofsydney.nsw.gov.au/pages/terms-and-conditions) | refused | terms bar robots, automated access or mining, with no leave for an AI agent | 2026-10-02 |
| `whc.unesco.org` | UNESCO World Heritage Centre | some paths closed | [bar mining, bar automated access, bar AI use, allow](https://www.unesco.org/en/terms-use) | allowed | terms reserve mining and expressly permit an AI system retrieving single pages to answer a query, naming UNESCO; a property page (`/en/list/<id>`) answers 403 and is not read; closed paths not read | 2026-10-02 |
| `www.ytuqueplanes.com` | PromPerú | open | [silent on automated reading](https://www.ytuqueplanes.com/terminos-y-condiciones) | allowed | — | 2026-10-02 |
| `zanzibartourism.go.tz` | Zanzibar Commission for Tourism | unreachable | not read | refused | `robots.txt` unreachable, read as a complete disallow (RFC 9309 § 2.3.1.4) | 2026-10-02 |
| `zh.wikivoyage.org` | Wikimedia Foundation (Wikivoyage, content under CC BY-SA 4.0) | some paths closed | [allow, limit the rate](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use) | allowed | through the API, one request at a time; closed paths not read | 2026-10-02 |
