# How established guides write for screens, and how this project's screens compare (2026-11-10)

#2432 asks for one guideline for the text on this project's screens, drawn from established
practice and not invented screen by screen. This report reads seven sources of that practice on
eleven questions. It then measures this project's screens against them. The guideline written
from it is `docs/tech/interface-writing.md`.

**Short answer.**

1. **Length.** The sources that give a number agree on about 20 words a sentence: 15 to 20 for
   Nielsen Norman Group, split above 25 for GOV.UK, an average of 20 and never over 40 for the US
   plain-language guidelines. Microsoft gives no count but asks for at most two linked clauses
   and one verb a sentence.
2. **Order.** All seven put the most important thing first. On screen that is the first two
   words of a line, which is about what a scanning reader sees.
3. **Punctuation.** GOV.UK forbids the semicolon. Material avoids the em dash. Microsoft reads a
   semicolon as a sentence to split.
4. **Figures.** A table is the sources' tool for comparing figures: GOV.UK, Microsoft, the US
   guidelines and Nielsen Norman Group all recommend one. None of them forbids a comparison in
   prose. Keeping compared figures out of prose is this project's rule, drawn from that advice.
5. **Detail.** Detail that only some readers need goes behind a disclosure. What most readers
   need stays on the page.
6. **Our screens.** On the five screens read on the development stack, 19 of 63 sentences are
   over 20 words, 11 over 25 and 6 over 40. In the web app's static strings, 72 sentences hold a
   semicolon and 169 a spaced em dash.

## Method

- **Sources.** Each was read on 2026-11-10 from its own pages. Material Design's and Apple's
  pages are drawn by JavaScript, so their text was read from each site's own content endpoint,
  the JSON the page is built from. The other sites were read as served. The quotes are short
  extracts of each page. GOV.UK's sentence limit, Microsoft's clause limit and Nielsen Norman
  Group's sentence limit were read a second time to confirm the wording.
  - **GOV.UK**: the writing guidance (moved to `guidance.publishing.service.gov.uk`; the
    `gov.uk/guidance` addresses redirect there) and the GOV.UK Design System.
  - **Material Design**: Material 3's content design, and Material 2's writing and empty-states
    pages where Material 3 is silent.
  - **Apple**: the Human Interface Guidelines' *Writing* page (updated 2025-12-16), *Loading*,
    *Alerts*, *Onboarding* and *Offering help*.
  - **Microsoft**: the Microsoft Writing Style Guide.
  - **Nielsen Norman Group**: its articles on how people read screens, with their studies.
  - **US plain language**: the Federal Plain Language Guidelines, now at
    `digital.gov/guides/plain-language`, which says its content is adapted from
    plainlanguage.gov. The sentence-length tip survives only on the archived plainlanguage.gov
    *Quick Tips* page.
  - **ISO 24495-1**: *Plain language — Part 1: Governing principles and guidelines*, read in the
    public preview of its final draft. iso.org answered 403 to a request. The International Plain
    Language Federation's page on the standard now serves unrelated content, so it is not cited.
- **Questions.** Each source was read on these questions:
  - (a) sentence length;
  - (b) one idea a sentence;
  - (c) what comes first;
  - (d) numbers and comparisons;
  - (e) dates and times;
  - (f) progressive disclosure;
  - (g) empty and waiting states;
  - (h) naming a source;
  - (i) punctuation;
  - (j) jargon;
  - (k) experts and general readers.
- **This project's screens.** The texts were read on the development stack (`main` at 64577d206)
  through a logged-in admin's browser. These were the review page with the *your pin is
  questioned* card of Aqua Claudia and the *holds a change* card of Nelson's Column, the
  crowded-city window of Aqua Claudia, the admin panel's *Sync Experiences* section and
  *Public Dumps*. A sentence is text between two sentence ends, and its words are counted as
  runs of letters and digits.
- **The static strings.** These were counted by a script over `frontend/src`: every quoted string
  of 20 characters or more and every JSX text, with tests, comments and generated files left out,
  split into sentences the same way. A card that builds its sentence from pieces in code, as the
  pin card does, is counted in pieces, so this count is a floor. The script is in § Appendix,
  run from the repository's root as `python3 measure.py` on `main` at 64577d206.

## What the sources say

### (a) Sentence length

| Source | What it says |
|---|---|
| Nielsen Norman Group | "Sentences should be no more than 15–20 words" ([Plain Language Is for Everyone, Even Experts](https://www.nngroup.com/articles/plain-language-experts/), 2017). It recommends a 6th–8th-grade reading level for a general audience and 10th–12th for experts. |
| GOV.UK | "Try to split up sentences that are over 25 words long." ([Clear language](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/)) |
| US plain language | "Aim for an average sentence length of 20 words, with no one sentence running over 40 words." ([Quick Tips, archived 2012](https://webarchive.library.unt.edu/web/20120915094258mp_/http://www.plainlanguage.gov/howto/quickreference/quicktips.cfm)) |
| Microsoft | No count. "Avoid linking more than three phrases or clauses… Better yet, avoid linking more than two." A sentence with "more than a few commas" is to be split ([Writing tips](https://learn.microsoft.com/en-us/style-guide/global-communications/writing-tips)). "Aim for one verb per sentence" ([Writing for all abilities](https://learn.microsoft.com/en-us/style-guide/accessibility/writing-all-abilities)). |
| Apple | No count for a sentence. A tooltip holds 60 to 75 characters at most, and a tip one or two sentences ([Offering help](https://developer.apple.com/design/human-interface-guidelines/offering-help)). |
| Material | No count for a sentence. A notification's title holds fewer than 29 characters and its expanded body fewer than 80 ([Notifications](https://m3.material.io/foundations/content-design/notifications)). |
| ISO 24495-1 | No number, by design. The standard judges "how successfully readers can use the document rather than … mechanical measures such as readability formulas" (Introduction). |

### (b) One idea a sentence, short text

- **US plain language**: "Express only one idea in each sentence" ([Write short sentences](https://digital.gov/guides/plain-language/writing/clear-short)).
- **GOV.UK**: "Paragraphs should have no more than 5 sentences each" ([Clear language](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/)).
- **Apple**: "If you're trying to convey more than one idea, consider breaking up the text onto multiple screens" ([Writing](https://developer.apple.com/design/human-interface-guidelines/writing)).
- **Microsoft**: "Short sentences and fragments are easier to scan" ([Brand voice](https://learn.microsoft.com/en-us/style-guide/brand-voice-above-all-simple-human)). "Replace complex sentences and paragraphs with lists and tables" ([Writing tips](https://learn.microsoft.com/en-us/style-guide/global-communications/writing-tips)).
- **Material 2**: "write UI text in short, scannable segments that focus on a limited number of concepts at a time" ([Writing](https://m2.material.io/design/communication/writing.html)).
- **Nielsen Norman Group** measured what happens otherwise:
  - 79 % of users scanned any new page, and 16 % read it word by word ([How Users Read on the Web](https://www.nngroup.com/articles/how-users-read-on-the-web/), 1997).
  - Users read at most 28 % of a page's words, and about 20 % is likelier ([How Little Do Users Read?](https://www.nngroup.com/articles/how-little-do-users-read/), 2008, from 45,237 page views of 25 users).
  - Concise text scored 58 % higher in measured usability, scannable text 47 % higher, and both with objective wording 124 % higher ([Concise, SCANNABLE, and Objective](https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/), 1997).

### (c) What comes first

- **All seven sources agree.** "Put the most important information first" (GOV.UK, [Clear structure](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-structure/)). "Lead with what's most important. Front-load keywords for scanning" (Microsoft, [Top 10 tips](https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice)). "Put the most important information first" (Apple, [Writing](https://developer.apple.com/design/human-interface-guidelines/writing)). "Put the most important info at the beginning" (Material, [Notifications](https://m3.material.io/foundations/content-design/notifications)).
- **ISO 24495-1** (5.2.2): "Place the most important message where readers can easily find it, commonly at the beginning." Also: "Place information that most readers need before information that only some readers need."
- **US plain language**: "General first. Exceptions, conditions, and specialized information later" ([Organize](https://digital.gov/guides/plain-language/principles/organize)).
- **Nielsen Norman Group** measured how far first is:
  - "Users typically see about 2 words for most list items" ([First 2 Words](https://www.nngroup.com/articles/first-2-words-a-signal-for-scanning/), 2009, 80 participants).
  - The first words on the left of each line get more fixations than the words after them ([F-Shaped Pattern](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/), 2017, reviewed 2026).
- **Apple and Microsoft** add what first means for an instruction: an alert's title says what happened, and a step names where the action takes place before the action.

### (d) Numbers and comparisons

- **Numerals**: GOV.UK, Material and Nielsen Norman Group write every number as numerals ("23, not twenty-three"). Microsoft spells out zero to nine in running text but uses numerals "in tables and UI". A thousands separator goes in every number of four or five digits or more, as the reader's locale writes it.
- **Comparisons go into a table.**
  - GOV.UK: "Use the table component to let users compare information in rows and columns", and "When comparing columns of numbers, align the numbers to the right" ([Table](https://design-system.service.gov.uk/components/table/)).
  - US plain language: tables reveal "relationships that are often hidden in dense text" ([Tables](https://digital.gov/guides/plain-language/design/tables)).
  - Nielsen Norman Group: "Tables are most effective when they allow users to easily compare data" ([Data Tables](https://www.nngroup.com/articles/data-tables/), 2022). In a table's cells, "Whenever possible, avoid full sentences" ([Comparison Tables](https://www.nngroup.com/articles/comparison-tables/), 2024).
  - Microsoft: "keep the text in each cell brief", and a blank cell or a dash is never the way to say none ([Tables](https://learn.microsoft.com/en-us/style-guide/scannable-content/tables)).
- **A chart or a set of figures** is explained by what it means, "rather than detailing every data point" (Material, [Alt text](https://m3.material.io/foundations/content-design/alt-text)).

### (e) Dates and times

- **A month is a word, not a number.** "Spell out the month, or use month abbreviations, not numbers… Jan. 2, 2003 is much less ambiguous than 01/02/03" (Nielsen Norman Group, [113 Design Guidelines for Homepage Usability](https://www.nngroup.com/articles/113-design-guidelines-homepage-usability/)). Microsoft gives the same reason: "6/12/2017 might be June 12, 2017 or December 6, 2017" ([Numbers](https://learn.microsoft.com/en-us/style-guide/numbers)).
- **The reader's locale.** Microsoft allows numbers in a UI date only "if the code … automatically displays the appropriate date format for different locales" ([Date and time terms](https://learn.microsoft.com/en-us/style-guide/a-z-word-list-term-collections/term-collections/date-time-terms)).
- **The time zone.** Name it "when it matters". A time stamp shown in the reader's local time needs none (Microsoft, [Time and place](https://learn.microsoft.com/en-us/style-guide/global-communications/time-place)).
- **Ranges and ordinals.** GOV.UK writes no ordinal ("2 June", not "2nd June") and uses "to" in a range, never a dash ([A to Z](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/)).
- **Apple and the US guidelines** say nothing on dates.

### (f) Progressive disclosure

- **What only some readers need goes behind a disclosure.**
  - "Use the details component to make a page easier to scan when it contains information that only some users will need" (GOV.UK, [Details](https://design-system.service.gov.uk/components/details/)).
  - "Reveal information progressively and as it's needed" (Material 2, [Writing](https://m2.material.io/design/communication/writing.html)).
  - "Progressive disclosure defers advanced or rarely used features to a secondary screen" (Nielsen Norman Group, [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/), 2006).
- **What most readers need never goes behind one.**
  - "Do not use the details component to hide information that the majority of your users will need" (GOV.UK).
  - "You have to disclose everything that users frequently need up front", and the link to more says what it opens (Nielsen Norman Group).
  - ISO 24495-1 (5.1.6): "Do not hide or leave out content that readers need to know."
- **A tooltip adds, never carries.**
  - "Users shouldn't need to find a tooltip in order to complete their task", and "Important information should always be on the page" (Nielsen Norman Group, [Tooltip Guidelines](https://www.nngroup.com/articles/tooltip-guidelines/), 2019).
  - A tooltip "doesn't just repeat what a label shows" (Microsoft, [tooltip](https://learn.microsoft.com/en-us/style-guide/a-z-word-list-term-collections/t/tooltip)).
  - It holds 60 to 75 characters (Apple).
- **Hint text** under a field is "a single short sentence, without any full stops", with no link in it (GOV.UK, [Text input](https://design-system.service.gov.uk/components/text-input/)).

### (g) Empty and waiting states

- **An empty screen says what to do.** "Do not default to totally empty states" (Nielsen Norman Group, [Empty State Interface Design](https://www.nngroup.com/articles/empty-state-interface-design/), 2021). "Provide clear next steps on any blank screens" (Apple, [Writing](https://developer.apple.com/design/human-interface-guidelines/writing)).
- **A wait says what is happening and for how long.**
  - "Clearly communicate that content is loading and how long it might take" (Apple, [Loading](https://developer.apple.com/design/human-interface-guidelines/loading)).
  - "Where possible, state exactly what the wait time will be" (Nielsen Norman Group, [Status Trackers](https://www.nngroup.com/articles/status-tracker-progress-update/), 2019).
  - A wait of 10 seconds or more needs a percent-done indicator and a way to stop it ([Response Times: The 3 Important Limits](https://www.nngroup.com/articles/response-times-3-important-limits/)).
- **The wait states the facts, not the process.** It gives "the details that are essential to understanding a current state", as in "Signing in… This can take up to 5 minutes". It leaves out "how an action or process is performed" (Material 2, [Writing](https://m2.material.io/design/communication/writing.html)).
- **The words are the reader's.** "Backend codes and internal jargon … mean nothing to the user" (Nielsen Norman Group, [Status Trackers](https://www.nngroup.com/articles/status-tracker-progress-update/)).
- **A failure says what happened and what to do.**
  - An error message should "Describe what has happened and tell them how to fix it", without "please", "sorry", "oops", "valid" or "invalid", and never a generic "An error occurred" (GOV.UK, [Error message](https://design-system.service.gov.uk/components/error-message/)).
  - "Avoid technical jargon and use language familiar to your users instead", and "offer some potential remedies" (Nielsen Norman Group, [Error-Message Guidelines](https://www.nngroup.com/articles/error-message-guidelines/), 2023).
- **GOV.UK, Microsoft and the US guidelines** have no empty-state pattern. GOV.UK's nearest guidance is on errors, above.

### (h) Naming a source

- **A link says where it goes.**
  - "Consider using the title of the page the link goes to as your link text" (GOV.UK, [Add links](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/)).
  - Microsoft says the same ([URLs and web addresses](https://learn.microsoft.com/en-us/style-guide/urls-web-addresses)).
  - "Click here" and "more" are refused as link text by GOV.UK, Apple and Microsoft.
- **A figure links to where it comes from.**
  - "Link to the data that generated the chart or graph" (Material, [Alt text](https://m3.material.io/foundations/content-design/alt-text)).
  - Nielsen Norman Group's users judged a claim by its source. They said "Links … help you judge whether what the author is saying is true" ([Concise, SCANNABLE, and Objective](https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/)). Experts asked for "a link to the source of that data" ([Writing Digital Copy for Domain Experts](https://www.nngroup.com/articles/writing-domain-experts/), 2017).
- **No source asks for the method of reading a source to be shown in its place.**

### (i) Punctuation

- **Semicolons.**
  - "Do not use semicolons as they are often mis-read" (GOV.UK, [A to Z](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/)).
  - "Sentences that contain semicolons are often complex. Try to simplify the sentence" (Microsoft, [Semicolons](https://learn.microsoft.com/en-us/style-guide/punctuation/semicolons)).
- **Em dashes.**
  - "Em dashes are best avoided in UX writing, as they indicate a break in the flow of a sentence that could be simplified using a comma, period, or new sentence" (Material, [Style guide](https://m3.material.io/foundations/content-design/style-guide)).
  - Microsoft allows them but says "don't overuse them" ([Dashes](https://learn.microsoft.com/en-us/style-guide/punctuation/dashes-hyphens/)).
- **Parentheses** "shouldn't be used when adding a side note or an afterthought" (Material).
- **Several marks together**: "Rambling sentences … tend to have an overabundance of commas, semicolons, and clauses" (Nielsen Norman Group, [Plain Language Is for Everyone, Even Experts](https://www.nngroup.com/articles/plain-language-experts/)).
- **Apple** says nothing on these marks.

### (j) Jargon and (k) experts

- **Jargon depends on the reader.**
  - "Whether or not a given word counts as jargon depends on who is reading it" (Nielsen Norman Group, [Technical Jargon](https://www.nngroup.com/articles/technical-jargon/), 2023).
  - "Use technical terms where you need to. They're not jargon", explained at first use (GOV.UK, [A to Z](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/)).
  - "Use industry-specific terms for professional audiences… use the words your audience uses" (Microsoft, [Technical terms](https://learn.microsoft.com/en-us/style-guide/word-choice/use-technical-terms-carefully)).
  - "Use one term consistently to represent one concept" (Microsoft, [Simple words](https://learn.microsoft.com/en-us/style-guide/word-choice/use-simple-words-concise-sentences)).
- **Experts still scan.**
  - "Like other users, they scan text and read only what is interesting or relevant to them", and "Lead with data and facts" (Nielsen Norman Group, [Writing Digital Copy for Domain Experts](https://www.nngroup.com/articles/writing-domain-experts/)).
  - "Some users can understand complex specialist language, but they do not want to read it if there's an alternative" (GOV.UK, [Clear language](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/)).
  - "Don't write for an 8th-grade class if your readers are PhD candidates" (US plain language, [Principles](https://digital.gov/guides/plain-language/principles)).
- **Each rule holds for the curator's and the admin's screens too.** A curator and an admin are
  experts in what they decide, not in how the code decides it.

## Where the sources disagree

- **Numerals under ten.** Microsoft spells them out in running text. GOV.UK, Material and Nielsen
  Norman Group do not. Microsoft too uses numerals in tables and interfaces, which is all a screen
  holds.
- **The em dash.** Material avoids it, Microsoft allows it in moderation, and Apple and GOV.UK say
  nothing about it.
- **Numbers or none.** ISO 24495-1 sets no sentence length on purpose. The others that set one
  agree on about 20 words. A number a lint can count stands in for the standard's real test: whether
  the reader finds, understands and uses the text.

## This project's screens against them

| Measure | On the five screens read | In the static strings of `frontend/src` |
|---|---|---|
| Sentences | 63 | 1,445 |
| over 20 words | 19 | 51 |
| over 25 words | 11 | 27 |
| over 40 words | 6 | 3 |
| with a semicolon | not counted | 72 |
| with a spaced em dash | not counted | 169 |

The longest sentences on screen are the ones a card builds from pieces, so the static count
misses them:

- **65 words**: the review list's row for Aqua Claudia. It gives seven figures against six bars
  in one sentence, joined by a semicolon.
- **59 words**: the last trial's line on *Public Dumps*.
- **58 words**: the opening of every *holds a change* card.
- **57 words**: the opening of every *your pin is questioned* card. It lists every reason a run
  might ask again, with two dashes, before the card says what it asks.

In the static strings the longest sentences are the curator's explanations of a field
(`fieldMeaning.tsx`) and the words of a kind's types (`experienceTypes.ts`). Five more findings
fall outside the sources' terms:

- **Two numbers that differ, set in two long sentences.** The Aqua Claudia card shows the answer's
  figures and the run's in two sentences of 51 and 60 words. They differ in three numbers
  (150,543 against 151,266 readers, 25,421 against 25,428, and the World Heritage List named in
  one only). Nothing marks which ones.
- **A source named by its class.** Nelson's Column's row says it was "Read from English
  Wikipedia's 'Monuments and memorials to …' category of the place's article, or a category of
  what a memorial concerns". The category it read, *Monuments and memorials to Horatio Nelson*,
  is not named.
- **A figure written against its bar as a fraction.** The crowded-city window reads "Better within
  10 km 57 of 10", which reads as 57 out of 10.
- **Dates in the host's numbers, with seconds.** "You put it back on 11/2/2026, 9:54:54 PM" reads
  as 11 February in most of Europe.
- **Development records sent by the backend.** *Public Dumps* shows "(#1434)", "(ADR-0143
  decision 3, #1895)" and "(ADR-0055)" in a dump's description. The text is the catalog's
  (`about` in `backend/src/services/dumps/catalog.ts`), so the web app's lint against such
  records (`SCREEN_TEXT_SELECTORS`, #1577) cannot see it.

## What this report does not show

- **Whether a reader decides faster.** No reading test was run on this project's screens. The
  measured effects quoted are Nielsen Norman Group's, on other sites and other readers.
- **The parts behind the counts.** Only five screens were read whole on the development stack.
  The static count reaches every string but not the sentences a card builds from pieces. The
  screens the rewrite covers (#1506) are measured one by one when each is rewritten.
- **Part of ISO 24495-1.** Only the public part was read: its principles, clause 4 and
  clause 5.2. Its guidelines on sentences (5.3) were read by title only.

## Appendix: the script that counted the static strings

It reads every `.ts` and `.tsx` file under `frontend/src` but the tests and the generated ones,
drops the comments, and takes every quoted string of 20 characters or more and every JSX text
that reads as prose. It splits each into sentences and counts each sentence's words, semicolons
and spaced em dashes. A string that holds code (an arrow, an `import`, `className`) is left out.

```python
import re,sys,os,collections
root='frontend/src'
lit=re.compile(r"'((?:[^'\\\n]|\\.){20,})'|\"((?:[^\"\\\n]|\\.){20,})\"|`([^`\n]{20,})`|>\s*([A-Z][^<>{}\n]{20,}?)\s*<",re.S)
sent_split=re.compile(r'(?<=[.!?])\s+(?=[A-Z“"(])')
words=lambda s: len(re.findall(r"[A-Za-z0-9][\w’'.,%-]*",s))
rows=[]
for d,_,fs in os.walk(root):
    if 'generated' in d: continue
    for f in fs:
        if not f.endswith(('.tsx','.ts')) or '.test.' in f or 'generated' in f: continue
        p=os.path.join(d,f); t=open(p).read()
        t=re.sub(r'/\*.*?\*/','',t,flags=re.S); t=re.sub(r'(^|\s)//[^\n]*','',t)
        for m in lit.finditer(t):
            s=next(g for g in m.groups() if g)
            if not re.search(r'[a-z]{3,} [a-z]{3,} [a-z]{2,}',s) or re.search(r'=>|[{};=]\s*$|\b(const|return|import|function)\b|className|sx=',s): continue
            if re.search(r'^[\w./@:-]+$|className|SELECT|=>|\$\{.*\}.*\$\{.*\}.*\$\{',s) and words(s)<6: continue
            for x in sent_split.split(s):
                n=words(x)
                if n>=4: rows.append((n,p,x.strip()[:160],x.count(';'),x.count(' — '),x.count('(')))
total=len(rows)
over20=[r for r in rows if r[0]>20]; over25=[r for r in rows if r[0]>25]; over40=[r for r in rows if r[0]>40]
semi=[r for r in rows if r[3]]; dash=[r for r in rows if r[4]]
print('sentences',total,'>20',len(over20),'>25',len(over25),'>40',len(over40),'with ;',len(semi),'with — ',len(dash))
byarea=collections.Counter(r[1].split('/')[3] if r[1].count('/')>3 else r[1] for r in over25)
print(byarea.most_common(8))
for r in sorted(over25,reverse=True)[:5]: print(r[0],r[1],r[2])
```
