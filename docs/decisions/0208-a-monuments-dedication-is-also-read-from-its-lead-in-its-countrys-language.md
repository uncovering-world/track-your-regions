# ADR-0208: A monument's dedication is also read from its lead in its country's language

**Date:** 2026-11-15
**Status:** Accepted
**Issue:** [#2491](https://github.com/uncovering-world/track-your-regions/issues/2491), slice 2 of [#2472](https://github.com/uncovering-world/track-your-regions/issues/2472)

---

## Context

ADR-0201 decision 1 reads the lead of a place's English Wikipedia article only. A Public art or
Monuments & memorials place with no English article, or whose English lead states no dedication,
gets no *Commemorates* line from the lead step, though its own-language article often states one.
In #2472's measurement, 9 of the 24 dedications both models agreed on came from an own-language
lead: Russian (the Monument to Peter the Great in Arkhangelsk, the Keyboard monument, the Monument
to Zoya Kosmodemyanskaya), Thai (the Democracy Monument), German (the Soviet War Memorial
Schönholzer Heide), Polish, Spanish, Belarusian (Victory Monument, Minsk) and Hindi (Kusum
Sarovar). That measurement picked each lead's language by hand.

The repository had no rule that ties a country to a language. #1905 plans one per region, from
Wikidata's official-language statements (`P37`) among others, and it is not built. The catalogue
already maps a Wikimedia language code to an edition and its address (`wikiOfLanguage`,
`editionUrl`, #2209).

## Decision

1. **The own-language lead is read where the English one names none.** After the English lead step,
   every place still without a dedication — no English article, an English lead that links nothing,
   or one the two models did not agree on — has the lead of its article in its country's language
   read, marked and asked the same way. A place whose English lead was not read or not asked about
   because its fetch or a model's call failed, or because a model gave no readable answer (a
   refusal, one cut at the limit, one outside the asked shape), is not read in another language on
   that pass, so the English lead stays the first answer; an English lead a host refuses to serve
   (robots, `ai-input=no`) counts as none.
2. **The language is the country's official language, as Wikidata states it.** The place's
   standing countries (`P17` at its best rank, no end time), each country's official languages
   (`P37`, the same, leaving out one a qualifier confines to a part of the country: *applies to
   part* `P518` or *valid in place* `P3005`), each language's Wikimedia language code (`P424`),
   and the edition that code names. A language with no code of its own at its best rank takes its
   nearest ancestor's: its *subclass of* chain (`P279`, best rank) is walked breadth-first, three
   steps at most, parents in the same order as below, and the first ancestor whose code names a
   Wikipedia edition answers. Standard Chinese, official in China and Taiwan, has no code and
   reads Chinese's `zh`; Moldovan reads Romanian's `ro`. Its ISO codes (`P218`, `P305`) are never
   read: Moldovan's `mo` names a closed edition, Standard Chinese's `cmn` none. An ancestor the
   subset does not keep ends that branch, and a language left with no code gives its country's
   places the English reading. The first of them, country by country and language by
   language, whose edition holds an article about the place is its own. English is passed over: a
   place in a country of English alone keeps the English reading, a place in India is read in
   Hindi, one in Canada in French. The order is the statements' own order in the local subset, and
   item order where the live query service answers, which keeps none.
3. **One own-language lead per place.** The first edition that has an article is read; a second
   official language is not asked when the first names none, so the cost stays at most one more
   lead per place.
4. **The question names the lead's language; the instructions stay English.** The measured
   instructions are sent unchanged, and the question adds the language of a lead not in English
   (`Russian (ru)`). An English lead's question is the one ADR-0201 measured.
5. **Kept per edition.** Each answer is kept under its edition
   (`workbench.lead_dedication_readings.wiki`, already part of the key), so an English answer never
   stands for another edition's lead.
6. **The agreed link is resolved on its own edition.** Its title is resolved to its item by that
   edition's own title-to-item lookup (`pageprops`, following a redirect), and the subject's article
   is the item's English article where it has one, never the own-language title.
7. **Everything else stays as ADR-0201 has it**: both models must name the same linked item, that
   item must be a human, an occurrence or a group, the value is written as every step's is
   (`via: 'lead'`), and a curator's claim wins. The lead is fetched on the same transport,
   User-Agent, pace and wait budget as the English one, flagged as a model's input so that
   edition's `ai-input=no` signal would refuse it.

ADR-0201 stands otherwise; this narrows its decision 1 (the English article only) and decision 4
(the title resolved as a category's title is, on English Wikipedia).

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A hand-written table from country to language | A second rule beside the one #1905 plans from Wikidata, kept by hand for some two hundred countries, and a list that would drift from the statements editors keep. |
| Every official language's lead | Switzerland or India would cost three or more leads and twice as many calls a place, for a step that is the last of seven and answers a fraction of the places. |
| Read the own-language lead first | The English leads are the ones ADR-0201 measured and calibrated on the catalogue; reading another edition first would change places that already have a line. |
| Translate the instructions | The measurement asked in English of leads in eight languages and the models answered across them; a translated prompt is a new, unmeasured prompt per language. |
| Resolve the link through the subset's sitelinks | The subset holds no redirects of other editions, and a lead often links a redirect (*Пётр I* rather than the article's full title); the edition's own lookup follows it. |

## Consequences

**Positive:**
- A monument whose English article is missing or silent gets a line where its own-language lead
  states one: the Democracy Monument commemorates the Siamese revolution of 1932, the Monument to
  Peter the Great in Arkhangelsk Peter the Great.
- The country-to-language rule is read from Wikidata, the same statements #1905 plans to read for
  regions.

**Negative / Trade-offs:**
- More paid calls: one more lead per place still without a line, read again only once that lead is
  edited.
- **The country rule is temporary.** It is replaced by the languages each region lists, once
  regions store them (#1905, "Every region lists the languages spoken and read in it"). The step
  then reads the list of the region a place stands in, and `places/ownLanguage.ts`, its subset twin
  `subset/ownLanguage.ts` and the walk they share (`places/languageCodes.ts`) are deleted, not kept
  beside it.
- Until then two cases read coarsely. A regional language its country does not hold officially is
  not read: a monument in Barcelona is read in Spanish, since Catalan is the official language of
  Catalonia (its `P37`) and not of Spain, and one in Kazan in Russian, not Tatar. A place whose
  `P17` names more than one country, as Crimea's name Ukraine and Russia, is read in the first
  country's language by statement order; that is an order, not a judgement about the territory.
  #1905's lists belong to regions, not to countries, and resolve both.
- An official language with no code of its own and no ancestor within three steps whose code names
  an edition, or one whose language item or ancestors the local subset does not keep, gives no
  code, and that country's places keep the English reading. On the development subset (2026-11-15)
  155 of the 159 nationwide official languages of the two kinds' countries are kept and 128 carry a
  code of their own. Among the rest, Standard Chinese and Moldovan reach a code through the walk,
  Filipino and Modern Standard Arabic do where an ancestor within three steps carries one (to be
  seen in the calibration), and the others are sign languages and dialects.
- A country whose statements list a widely read language after a less read one reads the first
  that has an article; a country whose official language is English but whose places are written
  about mostly in another keeps the English reading.
- The rule is measured again main against the branch on the development catalogue before merge,
  every changed place judged, as ADR-0201's was.

## Amendments

- 2026-11-15, before the pull request that accepts it merged: decision 2 gained the walk up a
  language's `P279` chain, after the development subset showed that Standard Chinese, Filipino,
  Moldovan and Modern Standard Arabic carry no code of their own; and the consequences say that the
  country rule is temporary and name its two coarse cases, by the maintainer's decision; and
  decision 1 counts a failed fetch of the English lead as a failed call, as the review asked, and
  then a model's unreadable answer about it too, as the next review asked.

## References

- Related ADRs: ADR-0201 (the lead step), ADR-0148 (outside services), ADR-0124 (workbench tier)
- Related docs: `docs/tech/experiences.md` § Whom or what a place commemorates, `docs/tech/external-services.md`
- Issue: #2491; #1905 (a region's languages)
