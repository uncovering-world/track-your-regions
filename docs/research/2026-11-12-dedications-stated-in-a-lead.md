# Which dedications a monument's lead states, and how they resolve to an item

Research for #2435, done on 2026-11-12 on the development stack.

## The question

The *Commemorates* line is read from Wikidata statements and English Wikipedia categories (#2144,
#2404, #2412, `backend/src/services/sync/places/commemorates.ts`). Some monuments state their
dedication only in their article's lead. Two things were measured. First, how often such a
dedication can be resolved to the right Wikidata item, and by which way. Second, what the way gets
wrong.

## Method

- **The sample.** The sample is #2404's 160 admitted monuments and public artworks with no
  reading. An earlier reading of each place judged where its dedication is stated. That reading is
  in `docs/local/research/commemorates/unread-1.jsonl` and `unread-2.jsonl`. The places whose
  dedication is stated only in a lead were measured: 47 in the English lead and 17 in the lead of
  the place's own language, 64 in all. The Republic Monument (Q1143790) was measured as a 65th
  place.
- **The leads.** The leads were read live from Wikipedia: 58 English and 17 in the place's
  language, whose title came from the subset's sitelinks. The 58 English leads are the 47
  places whose dedication the English lead states and 11 of the 17 whose own-language lead
  states it, read for comparison. The reader used `action=parse&section=0`, with `pageprops` to
  map a linked title to its item. That was 91 requests in all: 75 leads, 12 `pageprops` batches
  and the leads of 4 overview articles, 1.6 s apart, under the product's User-Agent (`userAgent()`). Wikidata was read
  only through the local subset (`wikidata_entities`, `wikidata_labels`,
  `wikidata_class_closure`).
- **The sentence.** In each lead, the sentence stating the dedication was found by its phrase: "to
  commemorate", "in memory of", "dedicated to", "in honour of", "a tribute to", and their
  equivalents in the place's language.
- **The ways.** Each dedication was resolved four ways:
  - **linked**: the item of the first article linked after the phrase.
  - **typed link**: the first linked item after the phrase that is a human, an event or a group.
  - **overview → event**: where the link is an overview article, the event its item's own
    statements name.
  - **subset search**: the dedication's key phrase looked up in the subset's labels, narrowed by
    the year the sentence gives against the item's P585, P580–P582 or P571.
- **The judgement.** Each answer was judged against the article and the item: *right*, *right but
  coarser* (the war for "the victory in the war"), *wrong*, or *nothing*.

## Result

### How often each way is right (64 places)

| Way | Right (exact + coarser) | Wrong | Nothing |
|---|---|---|---|
| linked | 19 (10 + 9) | 32 | 13 |
| typed link | 23 (10 + 13) | 11 | 30 |
| overview → event | 3 (1 + 2) | 0 | 61 |
| subset search | 20 (11 + 9) | 11 | 33 |
| typed link, then subset search | 27 (14 + 13) | 13 | 24 |
| typed link and subset search agree | **14** (6 + 8) | **0** | 50 |

Order matters. Search first and then the typed link gives 25 right and 15 wrong. The plain first
link first gives 20 right and 33 wrong. Where the typed link and the search name the same item,
none of the 14 was wrong. 6 are exact and 8 coarser than the dedication. In 7 of the 8 the
dedication is a group of people with no item, read as the event that defines it: the victims of
the Jallianwala Bagh massacre, the Soviet dead of the Battle of Berlin. In the eighth, the
Vittoriale degli italiani, it is the war for the victory in it. Among the 14 are the Jallianwala Bagh, the Soviet War Memorial in the
Schönholzer Heide, the National Monument of Scotland, the Monument to the Heroic Defenders of
Leningrad, the Oklahoma City National Memorial and the Monument to Peter the Great in Arkhangelsk.

Of the 64, 6 state no dedication on a closer reading. The judged kinds of dedication are: a group
of people 22, an event 19, a person 13, an idea 4.

### Why a way is wrong

- **The first link is not the subject.** 11 of *linked*'s 32 wrong answers are an adjective, a
  title or an office linked before the name: "the Russian emperor Peter I" in Arkhangelsk,
  "Hero of the Soviet Union Zoya Kosmodemyanskaya", "President Buchanan". Martyrs' Lane in Baku
  is "dedicated to those killed by the Soviet Army during Black January", and its first link is
  the army that killed them.
- **The subject is not linked.** Our Lady of the Rockies is "a tribute to the Virgin Mary" with
  no link there, so the first link is *cancer*, the founder's wife's illness. The search for
  "Virgin Mary" finds a cocktail.
- **A label names something else.** For the Shaheed Minar, the exact label "language movement"
  finds the 1961 Barak Valley movement, while the 1952 one is labelled "Bangla language
  movement".
- **No dedication, read as one.** Eagle Gate "pays homage to" its predecessor and gives Brigham
  Young. The Russian Monument's inscription gives Alexander II.
- **The reading is stale on the ground.** The Arch of Freedom of the Ukrainian People (formerly
  the People's Friendship Arch, Kyiv) gives, by *overview → event*, the Treaty on the Creation
  of the USSR, which its old name stood for. The arch was renamed in 2022, and that reading no
  longer describes it.

### The Republic Monument

No way finds what its lead says: "to commemorate the formation of the Turkish Republic in 1923".
- *linked* gives *history of the Republic of Turkey*, an overview.
- *overview → event* finds nothing. That item holds only P279 and P910, and its lead links the
  abolition of the sultanate.
- *subset search* finds nothing for "formation of the Turkish Republic".

The right item, the proclamation of the Republic of Turkey (Q31187690), is in the subset's labels
but has no entity row, so no date or class can be checked against it. Only the word
"proclamation" reaches its label.

### Groups with no item of their own

18 of the 64 are dedicated to a group of people that has no item: the Red Army soldiers who fell
in the Battle of Berlin, the victims of the Jallianwala Bagh massacre, the defenders of Leningrad.
The sentence names the group in words in all 18, and links the article of the event that defines
it in 15. A card could name such a group in words, linked to that article. Today a subject is an
item, though (`CommemoratedSubject`): the card, the review card and the curator's field all read
`item`. A subject with no item is a change of that shape, and a curator would then review a
sentence rather than a choice of item.

## What the measurement supports

- A lead-stated step can be safe if it accepts only the answers where the typed link and the
  subset search name the same item: 14 right and none wrong of 64, about one in five. It would
  come after the six steps, for a place none of them names. Each of the others alone is wrong on
  11 or more places, too many for a line a run writes on an arrival unseen.
- *Overview → event* adds nothing beyond the typed link, and should not be a step.
- Dropping organisations from "group" would make the typed link alone 26 right and 8 wrong. That
  tweak was found after seeing this sample, so it is not an independent measurement.
- Naming a group with no item, in words, is a product decision about a subject's shape, not a
  reading step.

## What it does not show

- **The sample is small.** It holds 64 places with a stated dedication, taken from #2404's 160.
  The counts are of this sample only.
- **The search read few label languages.** It read labels in English, Spanish, Italian and German
  only. It did not read `mul`, where a person's name often lives, nor the French and Dutch labels
  the subset also holds, so the search may have missed people it could have found. A phrase in
  another language was translated to English before the search.
- **Some right items are out of reach.** Several have no entity row in the subset, for example
  Anna of Russia, the Siamese revolution of 1932, the Lahore Resolution, James Prinsep and Suraj
  Mal, so no date or class could be checked.
- **The class tree is noisy.** It files *Hero of the Soviet Union* and *cancer* under
  occurrence, which a typed link must not trust alone.
- **Nothing reads statements in reverse.** No index answers "which event has this place as its
  P793 or P2184", so that way was not measured.

The rows, with each sentence, link and verdict, are in `docs/local/research/2435-leads/places.jsonl`
(unpublished, with the scripts that produced it).
