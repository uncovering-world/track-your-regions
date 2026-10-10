---
slug: fi-museovirasto-suojellut
name: Museovirasto — the protected sites of the cultural-environment registers (WFS rajapinta_suojellut)
publisher: Museovirasto (Finnish Heritage Agency)
urls:
  home: https://www.kyppi.fi/
  dataset: https://www.museovirasto.fi/fi/palvelut-ja-ohjeet/tietojarjestelmat/kulttuuriympariston-tietojarjestelmat/kulttuuriympaeristoen-paikkatietoaineistot
  api: https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs
  terms: https://www.museovirasto.fi/fi/palvelut-ja-ohjeet/tietojarjestelmat/kulttuuriympariston-tietojarjestelmat/kulttuuriympaeristoen-paikkatietoaineistot
family: registry
kinds: [world-heritage, architecture, archaeology]
tier: regional
unit: { level: country, code: FI, name: Finland }
row:
  identity: "the register's KOHDEID / rakennusID (kyppi.fi `to.aspx?id=130.<KOHDEID>`), an INSPIRE id, and for an RKY area its KOHDE_ID on rky.fi; Wikidata links to an RKY area by P4009 and to an archaeological site by P4106"
  wikidata_link: P4009
  coordinates: all
  languages: [fi]
  signal: "the protection itself — a protected building with its act (Asetus 480/85, Kirkkolaki, Rautatiesopimus 1998), a protected ancient monument, an RKY area (a nationally significant built cultural environment), a World Heritage area"
terms:
  licence: "CC BY 4.0 (the geodata); the text and photographs of the rky.fi and kyppi.fi pages are © Museovirasto"
  database_right: waived
  attribution: "Museovirasto, CC BY 4.0"
  scraping: not-needed
access:
  mode: api
  format: "WFS 2.0 (GeoJSON, any srsName), 13 layers: suojellut_rakennukset_{piste,alue}, muinaisjaannos_{piste,alue}, rky_{piste,viiva,alue}, maailmanperinto_{piste,alue}, muu_kulttuuriperintokohde_{piste,alue}, vark_{pisteet,alueet}; AccessConstraints NONE, no key"
  cadence: continuous
  volume: "2,289 protected-building points, 64 RKY points, 6 World Heritage points on 2026-10-10 (GetFeature with count=1 and numberMatched); the RKY area layer holds the Aalto works as areas"
  rate: "none published; the measurement read each layer once as a whole and asked a handful of filtered questions a second apart"
scorecard:
  date: 2026-10-10
  completeness: 1
  identity: 2
  coordinates: 2
  names: 1
  signal: 1
  terms: 2
  access: 2
  cadence: 2
  total: 13
  verdict: adoptable
status: looked-at
issue: 1306
looked_at: 2026-10-10
---

# Museovirasto — protected sites over WFS

Finland's heritage agency publishes its cultural-environment registers as open geodata: the
protected buildings, the protected ancient monuments, the RKY areas (*valtakunnallisesti
merkittävät rakennetut kulttuuriympäristöt*, the nationally significant built environments) and
the World Heritage areas, through one WFS with no key. Looked at by #1306 for the 13 components
of the Aalto Works, none of which carries a Wikidata item on the development catalogue.

**What was measured (2026-10-10).** `data/tmp-1306/finland.mts` read two layers whole in
WGS 84 and matched them to the 13 points. The World Heritage points layer holds 6 features and
none of them is Aalto's — it predates the 2025 inscription. The protected-buildings point layer
(2,289 features; `kohdenimi`, `rakennusnimi`, `Kunta`, `suojeluryhmä`, `suojelun_tila`, `url`)
has a building within 1 km of 10 of the 13 points, but it is the *neighbour*: the National
Museum 160 m from Finlandia Hall, Noormarkku church 590 m from Villa Mairea, Jyväskylä
university's main building 122 m from the Aalto campus point. The one component in that layer
is the Church of the Three Crosses — `Vuoksenniskan kirkko ja pappila`, 1 m away, protected
under the Church Act. Searched by Finnish name (`fi-areas.sh`, `cql_filter` with ILIKE), the
building layers hold no Paimio sanatorium, Villa Mairea, Sunila, Säynätsalo town hall,
Kulttuuritalo or Kela head office. The **RKY area layer does**: *Paimion parantola* (KOHDE_ID
1795), *Sunilan tehtaat ja asuinalue* (1280), *Seinäjoen Aalto-keskus* (1667), *Säynätsalon
teollisuusyhdyskunta* (230), *Finlandia-talo, Kaupunginteatteri ja Kulttuuritalo* (4664) — each
an area, not a point per building, with a Finnish description page on rky.fi (the Paimio page
runs about 8,700 characters of text and bibliography, with three photographs credited to their
photographers under "© Museovirasto 2009").

**Terms.** museovirasto.fi: "Museoviraston paikkatiedot on julkaistu Creative Commons CC By 4.0
-lisenssillä" — the geodata is CC BY 4.0. The rky.fi and kyppi.fi pages carry "© Museovirasto"
and credit each photograph to its photographer; they are linked, not copied, and their pictures
are not Commons files (ADR-0043). `robots.txt`: kyppi.fi open to every agent but Googlebot's
one closed path; rky.fi none (404), which allows.

**What it is for.** For a Finnish component with no item, the RKY area that contains the point
gives an official Finnish name, an outline and a description page to link; the protected-
buildings layer gives the protection and the register page where the component is a single
protected building. Neither gives a picture the product may draw. The RKY id is Wikidata's
P4009, so an RKY area found by containment is also a way to the item.
