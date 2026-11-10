# Writing for the screen

How the text a visitor, a curator or an admin reads is written. The guideline is drawn from
GOV.UK, Material Design, Apple, Microsoft, Nielsen Norman Group, the US plain-language guidelines
and ISO 24495-1. [The 2026-11-10 report](../research/2026-11-10-how-established-guides-write-for-screens.md)
holds what each says, with its source, and how this project's screens measured against them.

It covers every string a person reads, wherever it is written:

- **The web app**: labels, headings, helper and hint text, tooltips, card bodies, dialogs, empty
  and waiting states, errors.
- **The backend**: any text it sends to a screen, which the web app's lint cannot see. This
  includes a dump's description (`about` in `services/dumps/catalog.ts`), a run's refusal reason,
  a failed build's message and a held change's words.

The rules apply to all three roles alike. § Each role's words says how the words differ. What a
person wrote is not held to them: a curator's note, a place's name, a quoted title, a licence
credit.

## The rules at a glance

| # | Rule | The lint #2433 adds |
|---|---|---|
| 1 | A sentence holds at most 20 words, and none holds more than 25 | will check it |
| 2 | A sentence makes one point, with at most two clauses, and no semicolon or dash joins them | will check part |
| 3 | Figures that are compared go into a table or labelled figures, and a sentence holds at most two | will check part |
| 4 | A number is written in numerals, through the reader's locale, and never as a fraction of its bar | will check part |
| 5 | A date is a day and a month in words, in the reader's locale, and a time only where it matters | will check it |
| 6 | A block holds at most three sentences, a hint one, and a tooltip at most 75 characters | will check it |
| 7 | Nothing from the repository is on screen: no ADR, issue, file, symbol or internal table | checks ADR and issue numbers in the web app's strings today; will add the backend's |
| 8 | A card opens with what it asks | review only |
| 9 | A change is shown as before and after, with the difference marked | review only |
| 10 | A source is named as the thing that was read, and linked | review only |
| 11 | The body says what was found; how the rule works goes behind ⓘ | review only |
| 12 | A wait, an empty list and a failure say what happened, what stands and what to do | review only |
| 13 | Each role reads its own words, and one thing has one name | review only |

Only part of rule 7 is checked by a lint today: ADR and issue numbers, over the web app's strings
(`SCREEN_TEXT_SELECTORS`, #1577). A file, a symbol or an internal table on screen is caught in
review. The lint #2433 adds will check the rest of the column, over the
web app's strings and the backend's screen texts. *Part* means it will catch the plain cases,
such as a semicolon or five figures in a sentence, and review catches the rest. Until it lands,
every rule is checked when a branch is reviewed.

## The measurable rules

### 1. A sentence holds at most 20 words, and none more than 25

Aim for 20 words or fewer. A sentence over 25 words fails the lint, and is split in two or cut.
The 20 comes from Nielsen Norman Group (15 to 20) and the US guidelines (an average of 20).
The 25 is GOV.UK's point to split. A label, a button or a heading is not a sentence and is
shorter still.

**Before** (*your pin is questioned*, 57 words in its second sentence):

> A run asks about it again: either it says something else — it turns the place down for a
> different reason, or its rule would now take in what you kept out — or an admin asked for every
> such answer to be looked at again after the rule changed, and the run still says what you
> answered over.

**After:**

> You put Aqua Claudia back in Archaeology on 2 Nov. Today's run would leave it out again.

### 2. One point a sentence, at most two clauses, no semicolon or dash between them

A sentence joins at most two clauses: Microsoft's limit, and the US guidelines' one idea a
sentence. No semicolon joins two clauses, as GOV.UK forbids it. No em dash or spaced dash joins
or breaks a clause, as Material advises. Parentheses hold an abbreviation, a unit or a name,
never an aside.

*Lint*: a semicolon, a spaced dash (` — `, ` – `) and parentheses around four words or more
are refused. Two clauses or three are for review.

**Before** (the gate's switch, *Sync Experiences*):

> What is already waiting to be published would stay waiting: switching the gate off publishes
> nothing, because only a person can release it.

**After:**

> Switching it off publishes nothing. What waits stays until a curator releases it.

### 3. Figures that are compared go into a table, and a sentence holds at most two

Figures that are compared with each other or with a bar go into a table, or into labelled
figures, one to a line. Prose does not carry them. GOV.UK, Microsoft, the US guidelines and
Nielsen Norman Group recommend a table for comparing figures. Keeping them out of prose
altogether is this project's rule, drawn from that advice.
A sentence holds at most two figures. A table's cells hold no sentence.

*Lint*: a sentence with three figures or more, literal or interpolated, is refused. Whether a
comparison needs a table is for review.

**Before** (the review list's row for Aqua Claudia, 65 words):

> Archaeology · your pin is questioned: 24 Wikipedia editions and 46,234 readers a year as last
> read, no guide uses it and Atlas Obscura does not list it: under the world tier's bars (34
> Wikipedia editions, 151,266 readers a year, or 25,428 where a guide uses it, Atlas Obscura lists
> it or the World Heritage List inscribes it; a place held stays at 0.8 of any)

**After** (the row says what is asked, and the card holds the figures):

> Archaeology · your answer is asked again

| | Aqua Claudia | The bar |
|---|---|---|
| Wikipedia editions | 24 | 34 |
| Readers a year | 46,234 | 151,266 |
| A guide, Atlas Obscura or the World Heritage List lists it | no | 25,428 readers where one does |

Aqua Claudia is in Archaeology already, so it stays while it holds 0.8 of any bar.

### 4. Numbers are numerals, in the reader's locale, and never a fraction of their bar

A number is written in numerals, "3", not "three": GOV.UK, Material and Nielsen Norman Group,
and Microsoft for interfaces. It goes through the reader's locale (`Intl.NumberFormat`, or
`toLocaleString()` on a number), which puts in the thousands separator. A large one is rounded
where its digits do not matter: "about 150,000 readers". A figure stands beside its bar as
the bar, never as a fraction, which reads as a part of a whole.

*Lint*: a run of five digits or more with no separator, in a string, is refused. A figure
written as "N of M" where M is a bar is for review.

**Before** (the crowded-city window):

> Better within 10 km 57 of 10

**After:**

> Better known within 10 km: 57. It is shown with fewer than 10.

### 5. A date is a day and a month in words; a time only where it matters

A date is a day and a month in words, in the reader's locale: "2 Nov", or "2 Nov 2025" in a
year that is not this one. A date in numbers is ambiguous: 11/2/2026 is 2 November to an American
and 11 February to most of Europe. Nielsen Norman Group and Microsoft give this reason. A time
is shown only where it matters, to the minute, in the reader's own time, and never with seconds.
A recent moment may read as "today" or "3 h ago". The full date and time is then a hover, a
focus or a tap away, and is read out by a screen reader: a `<time>` element whose `dateTime`
holds it, with the full date as its accessible name.

*Lint* (#2433): `toLocaleString()` and `toLocaleDateString()` without options are refused on a
date. In `utils/dateFormat.ts` today, `formatDay` writes the day and the month in words but
never the year, so it follows this rule only for a date in this year. `formatDateTime`, a bare
`toLocaleString()` that prints the *before* below, and `formatRelativeTime`'s fallback past 30
days do not yet. The rewrite of the screens (#1506) changes them, and #2433's lint refuses
them until it does.

**Before** (the Aqua Claudia card):

> You put it back on 11/2/2026, 9:54:54 PM —

**After:**

> You put it back on 2 Nov:

### 6. A block holds at most three sentences; a hint one; a tooltip 75 characters

- **A block** holds at most three sentences: a card's body paragraph, a panel's intro or a
  dialog's text. Detail goes behind ⓘ (rule 11). GOV.UK allows five sentences a paragraph on a
  page. A card on a screen holds fewer.
- **A hint** under a field (`helperText`) is one short sentence with no link, as GOV.UK's hint text
  is.
- **A tooltip** holds at most 75 characters, Apple's limit. It adds what the label does not
  say, and nothing the task needs (Nielsen Norman Group).

*Lint*: a `helperText` or a tooltip's `title` over its limit is refused, and so is a
string of four sentences or more.

**Before** (the gate's switch, four sentences and 80 words):

> New objects from this source arrive invisible to readers, and a change to a visible object is
> kept back, until a curator passes it. What was published before the switch stays visible. What
> is already waiting to be published would stay waiting: switching the gate off publishes
> nothing, because only a person can release it. Switching it off would not hand the 79 changes
> being held back to a curator: the next run of this source would apply them instead.

**After:**

> A curator passes each new place and each change before readers see it. ⓘ

and, behind ⓘ: "Switching it off publishes nothing. The next run applies the 79 changes held
back now."

### 7. Nothing from the repository is on screen

A screen names no ADR, issue, pull request, file, symbol, internal table or setting
(`shared-frontend-patterns.md` § Text on screen, #1577). A licence credit stays, in plain words.
This applies to the backend's screen texts too, which the web app's lint never reads.

*Lint*: ADR and issue numbers in the web app's strings already (`SCREEN_TEXT_SELECTORS`).
#2433 adds the backend's screen texts. A file, a symbol or a table's name is for review until a
lint can tell it from an ordinary word.

**Before** (*Public Dumps*, a dump's description from `catalog.ts`):

> … so a place registered under an item Wikidata has since merged away is still found (ADR-0143
> decision 3, #1895).

**After:**

> … so a place registered under an item Wikidata has since merged away is still found.

## The judgement rules

### 8. A card opens with what it asks

The first words of a card, a row or a dialog say what the person is asked, or what happened.
Readers see about two words of a row or a list item before they move on (Nielsen Norman Group). All seven
sources put the most important thing first. Context, history and the rule come after the question,
or behind ⓘ.

**Before** (the opening of every *your pin is questioned* card, 92 words in three sentences,
before the card's own content):

> A curator — perhaps you — answered whether this place belongs in this list and pinned the
> answer, so every run kept it as they left it. A run asks about it again: …

**After:**

> **Keep Aqua Claudia in Archaeology?** You put it back on 2 Nov. Today's run would leave it out.

### 9. A change is shown as before and after, with the difference marked

What changed is shown side by side, before and after, with the changed values marked. It is not
told as two paragraphs a reader compares word by word. The review card's table of *Current* and
*Proposed* already does this. A question about a curator's answer should do the same.

**Before** (the Aqua Claudia card: two sentences of 51 and 60 words that differ in three
figures, none marked):

> 24 Wikipedia editions and 46,234 readers a year, no guide uses it and Atlas Obscura does not list
> it: under the world tier's bars (34 Wikipedia editions, 150,543 readers a year, or 25,421 …)
>
> 24 Wikipedia editions and 46,234 readers a year as last read, no guide uses it and Atlas Obscura
> does not list it: under the world tier's bars (34 Wikipedia editions, 151,266 readers a year, or
> 25,428 … or the World Heritage List inscribes it …)

**After:**

| The bar | When you answered, 2 Nov | Today's run |
|---|---|---|
| Wikipedia editions | 34 | 34 |
| Readers a year | 150,543 | **151,266** |
| Readers a year, with a guide | 25,421 | **25,428** |
| Also counts as a guide | Atlas Obscura | Atlas Obscura, **the World Heritage List** |

Aqua Claudia had 24 editions and 46,234 readers on both days. The bar moved, not the place.

### 10. A source is named as the thing that was read, and linked

A fact's source is named as the page or the item that was read, and linked to it. A link's text is
that page's title (GOV.UK, Microsoft), never "here" or "more". The class of sources a rule could
have read belongs behind ⓘ, if anywhere.

**Before** (Nelson's Column, *holds a change*):

> Added: Horatio Nelson. Read from English Wikipedia's "Monuments and memorials to …" category of
> the place's article, or a category of what a memorial concerns ("… related to X", "X monuments
> and memorials", "X memorials in …"), there a person or an event.

**After:**

> Added: Horatio Nelson. Read from English Wikipedia's category
> [Monuments and memorials to Horatio Nelson](https://en.wikipedia.org/wiki/Category:Monuments_and_memorials_to_Horatio_Nelson).

### 11. The body says what was found; how the rule works goes behind ⓘ

A screen says what the rule found for this place, this run, this file. How the rule works, the
cases it covers and why are for the readers who ask. They go behind ⓘ or a *How this works*
link that says what it opens. What most readers need stays on the page (GOV.UK, Nielsen Norman
Group, ISO 24495-1).

**Before** (the opening of every *holds a change* card):

> This came from a source held back until a person looks, so none of it has reached a visitor: an
> object nobody has passed yet, a change kept off a page readers can already see — or off one of
> the places or works it is made of — or newly-arrived points and works under a row that is
> visible. Publishing is what lets it out, and nothing else does.

**After:**

> Readers don't see this change yet. Use what the run proposes, or keep the current text. ⓘ

**Before** (*Start Sync*):

> One run brings the source up to date: it reads the source, finds the Wikidata items of the
> components it left without one, and pairs what it brought with near places of similar names. It
> preserves curator edits, visit history, manual region assignments and rejections; a point the
> source stops offering is marked, not deleted.

**After:**

> Brings this source up to date. Curators' edits, visits and rejections stay. ⓘ

### 12. A wait, an empty list and a failure say what happened, what stands and what to do

- **A wait** says what is happening and how long it may take. A wait of 10 seconds or more shows
  how far it has got and how to stop it (Apple, Nielsen Norman Group).
- **An empty list** says why it is empty and what to do, never nothing at all (Nielsen Norman
  Group, Apple).
- **A failure** says what happened, what stays as it was, and what to do next. It never shows a
  raw error or a generic one such as "An error occurred" (GOV.UK, Nielsen Norman Group).
- **A value not known yet** is said to be not known, with when it will be. It never reads as a
  result.

**Before** (the crowded-city window of the Russian Church in Florence, which had not been measured,
#2420):

> No better-known church stands within 10 km of it

**After:**

> Not measured yet: nothing is compared with it until the run in progress measures it.

**Before** (a failed dump build, until #2419):

> Failed · terminated

**After** (as #2419 writes it, shortened):

> The connection to dumps.wikimedia.org was closed after 2.2 GB of 3.6 GB of
> wikidatawiki-20261101-page.sql.gz. The next build resumes from the 2.2 GB on disk. The copy in
> place, built from the dump of 1 Oct 2026, is unchanged and still read.

### 13. Each role reads its own words, and one thing has one name

Whether a term is jargon depends on who reads it (Nielsen Norman Group). A curator and an admin
are experts in what they decide, not in how the code decides it. A term the role was not taught
on that screen is explained the first time, behind ⓘ. One thing keeps one name on every screen
(Microsoft).

**Before** (one card, two names for one thing):

> your pin is questioned · … the run still says what you answered over · Keep my answer

**After:** the curator's word is *answer* everywhere: "your answer is asked again" and "Keep
my answer".

## Each role's words

- **A visitor** reads a traveller's words. The visitor sees the place, its region, its kind and
  type, what it commemorates or depicts, the visit and the credit. A visitor never reads how the
  catalogue was filled: no run, source, tier, bar or score.
- **A curator** reads the words of the catalogue's decisions:
  - a new place, a change, a question;
  - *publish*, *keep out*, *put back*, *your answer*;
  - the run that asked, by when it ran.

  A curator may read the bars a place is measured against, as labelled figures (rule 3). The
  curator does not read a run's number, a gate's state name or the name of a field in the code.
- **An admin** reads an operator's words: a source, a run, a dump, a copy, a build, the disk.
  An admin may read a file's name, where the file is what the admin acts on. An admin does not
  read a setting's name, a table's name or a code path (rule 7).

## Text the backend sends

The backend writes some of what a screen shows. That text follows these rules as the web app's
does:

- a dump's description and how a file of it is read (`about` and `how` in `DUMP_WORDS`,
  `services/dumps/catalog.ts`);
- a copy's name and what reads it (`title` and `feeds` in `KEEPERS`, `services/dumps/keepers.ts`),
  on its Public Dumps card and in the run history's line of copies read;
- a failed build's message (`services/dumps/buildRun.ts`);
- a run's refusal reason and an admission's reason;
- the words of a held change.

It is written to be shown, not logged: in the role's words, with the figures labelled and the
source named. Where it carries figures, it is better sent as data the web app words. A refusal
reason, for one, becomes its figures and its bar, which the card shows as a table (rule 3).
#2433's lint reads the texts where they are declared. A message built in code is held to the
rules by its spec, which asserts the words a person reads.

## How a rule changes

A rule here changes when a screen that follows it reads worse than one that breaks it. The change
gives the case, before and after, and names the source it follows, or says that it departs from
the sources and why. A number in rules 1 to 6 moves only with a case like that. Every rule a lint
checks changes in the lint and here together (#2433).
