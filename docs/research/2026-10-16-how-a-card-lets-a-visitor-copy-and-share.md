# How a card lets a visitor copy, share and follow a place's facts (2026-10-16)

The research slice #1188 asked for, first slice of the Epic #1187. A visitor who has found a place
on the map wants to take something out of its card: tell a friend about it, paste its name or
address into a message or a maps app, follow it to its source. Today's Map-mode card was built to
be read and ticked. How do comparable interfaces let a person copy and share an object's facts,
what does established guidance say about each control, and what should this card do? The report
states no plan; the interface slices that cite it do (#1190–#1196).

## Today's card, on the development stack (2026-10-16, Map mode, signed in as an admin)

- **St Bavo's Cathedral, Ghent** (`/wv/5/r/6782-vlaanderen/e/13778-st-bavo-s-cathedral`): a
  picture with its credit line ("Michael Kranewitter · CC BY-SA 3.0 nl"), two chips (*Cathedral*,
  *Belgium*), the line "church in Ghent, Belgium", *Notable works (1)* with the Ghent Altarpiece
  (makers, year, type, a checkbox), and an action row: *Mark Visited*, a book icon (Wikipedia), a
  globe icon (the official website) and *Curate*. The two icons are links with an accessible name
  (#564) and no visible word.
- **Dragging across the name selects it and collapses the card in the same gesture**, and the
  address bar falls back to the region (`/wv/5/r/6782-vlaanderen`): the whole title row is one
  click target (`ExperienceListItem.tsx`, the row's `onClick`). The Epic's report of 2026-10-01
  still holds.
- **Belfries of Belgium and France** (`…/e/427-belfries-of-belgium-and-france`): picture and
  credit, *Cultural*, *France*, "26/56 in region", the World Heritage Centre's description,
  "Inscribed: 1999", and a list of its points in the region — named "Stadhuis met Belfort" five
  times, "Stadhuis", "Belfort en Hallen", with no town in any of them. A serial site of 56 belfries
  in two countries has no one address, and a point copied by its name tells a friend nothing.
- **Groeningemuseum, Bruges**, the Epic's example, is refused in Art Museums on the development
  catalogue today, so a visitor does not meet its card; its row holds a website and a Wikipedia
  article, and its works are rows in the same shape as the Ghent Altarpiece's.

## How comparable interfaces handle it

Read from each product's own documentation on 2026-10-16:

- **Google Maps** (help article "Share a map or directions", support.google.com/maps/answer/144361):
  on a computer, *Share or embed map* offers *Copy link* or *Copy HTML* for an embed; on a phone
  the place sheet's *Share* opens the system share sheet with a copy option. The share is of the
  place's link, never of a field: the help names no *copy address* control.
- **Apple Maps** (Maps User Guide for Mac, "Share a location"): the place card has one *Share*
  button that opens the system's sharing options; the toolbar's *Share* is a separate control for
  the whole map. Again one control for the object, not one per fact.
- **OpenStreetMap's website** (OSM wiki, "Browsing"): the *Share* panel offers a link and a short
  link to the view, optionally with a marker. Facts on a feature's page are text a person selects.
- **This product's own Discover side panel** (`ExperienceDetailPanel.tsx`) already lets the title
  be selected and labels its three link buttons ("Wikipedia", "Official website", "UNESCO
  page"); the Map-mode card is the surface behind.

The pattern across all three maps: **one Share control on the object**, handing the system's
share sheet a link (and on a phone a title); **facts are selectable text**; a copy button appears
where a value is long and meant to be pasted somewhere else — a link — not on every field.

## Established guidance

- **Icons need words.** Nielsen Norman Group's "Icon Usability" finds that few icons are
  recognised without a label (home, print and search are the exceptions), that a label belongs
  beside even standard icons, and that it must be visible rather than revealed on hover, which
  costs a step and does not exist on a touch screen. The card's book and globe are not among the
  recognised few.
- **A clickable card can keep its text selectable.** Inclusive Components ("Cards", Heydon
  Pickering) makes the whole card follow its one real link from a click on the container and lets
  a press that lasts longer than about 200 ms count as a selection, not a click, so dragging
  across the title selects it. Its pseudo-content alternative — the link's `::after` stretched over
  the card — is the one that makes text hard to select.
- **A copy control confirms in words, briefly.** Carbon's copy button (code snippet guidance and
  its accessibility page) pairs the button with a tooltip that describes the action, replaces it
  with "Copied!" after the click, keeps the feedback about two seconds (the default its component
  ships), and is operable with Space or Enter.
- **The confirmation is a status message.** WCAG 2.2 SC 4.1.3 asks that a message reporting the
  result of an action be exposed to assistive technology without moving focus; its example is a
  "Saved" pop-up read by a screen reader. "Link copied" is that kind of message: a polite live
  region, not a dialog.
- **The platform has both halves.** `navigator.share()` (MDN) opens the system share sheet with a
  `title`, `text` and `url`, needs a secure context and a user gesture, rejects with `AbortError`
  when the person cancels, and has limited availability (desktop Firefox among the gaps).
  `navigator.clipboard.writeText()` is widely available since 2020, needs a secure context, and
  rejects with `NotAllowedError` when writing is not allowed. A share control therefore needs a
  copy fallback, and a copy needs a failure message.
- **A picture's reuse carries its credit.** Wikimedia Commons' "Reusing content outside Wikimedia"
  asks a reuser to credit the original author, name and link the licence and honour its terms; the
  file page and the Stockphoto gadget are where a reuser gets the file and a ready credit line. A
  raw copy of the pixels carries none of that.

## Recommendation

**Text that is a fact is selectable, and the title row stops eating the selection.** The row
toggles only on a click that is not a selection: a press past the selection threshold, or a
non-empty `window.getSelection()` inside the row, leaves the card as it is. The chevron becomes
the explicit toggle — a button with `aria-expanded`; today it is a bare icon inside the clickable
row (`expandIndicator` in `ExperienceListItem.tsx`). Name, description, a work's name and makers, the
address when there is one: all plain text, copied the way any text is.

**One Share control per card, labelled "Share".** It shares the card's own address
(`/wv/<view>/r/<region>/e/<id>-<slug>`, #1192) with the place's name as the title and the line
under it as the text ("St Bavo's Cathedral — church in Ghent, Belgium"). Where `navigator.share`
exists — phones, Safari, Chromium on Windows — it opens the system sheet; where it does not, it
copies the link and says "Link copied" for about two seconds, in a polite live region. A cancelled
share says nothing. A share that fails for another reason does not copy in its place: the sheet has
already spent the click's activation, which Safari's clipboard needs, so it says "Could not share"
and offers *Copy link*, a fresh click. It sits in the action row beside *Mark Visited*, the
visitor's two verbs together, ahead of *Curate*.

**Links get their words.** The book and the globe become text links with a small icon, in the
words the Discover panel already uses — "Wikipedia", "Official website", "UNESCO page" on a World
Heritage site — on one line under the description.
They stay links (`safeHref`, #708), so the browser's own *Copy link address* copies them; no copy
button is needed for a link. A notable work's name links to its Wikipedia article the same way
(#1191).

**A copy button for the address alone.** A street address is the one fact a traveller pastes
elsewhere — into a maps app, a taxi, a message — and is awkward to select on a phone. It gets a
line of its own under the description with an icon button labelled "Copy address" ("Address
copied", same feedback), and only where a source gives one (#1189; #1193 shows it). The name gets
no copy button: it is short, selectable once the row stops toggling, and *Share* sends it.

**The location goes to a maps app, not the clipboard.** "Open in maps" (#1194) hands the point to
a maps application; coordinates are not a fact a visitor reads, and a copy of them helps nobody
the maps link does not.

**The picture links to its Commons page.** The credit line already names the author and licence;
it becomes the link to the file's Commons page, where a reuser finds the file, its sizes and a
ready credit. A *Copy picture* control would hand over the pixels without the credit the licence
asks for (#1195 should weigh this; it is a product call).

**Walked through the three cards:**

| Card | Title | Action row | Links line | Address |
|---|---|---|---|---|
| St Bavo's Cathedral | selectable | *Mark Visited* · *Share* · *Curate* | Wikipedia · Official website | "Sint-Baafsplein 1A" with *Copy address* where #1193 shows it |
| Belfries of Belgium and France | selectable | *Mark Visited* · *Share* (the site's card) · *Curate* | UNESCO page · Wikipedia | none: 56 belfries have no one address |
| Groeningemuseum (when admitted) | selectable | *Mark Visited* · *Share* · *Curate* | Wikipedia · Official website | "Dijver 12" with *Copy address* |

A point of a serial site (a belfry) is shared from a fuller view if #875 produces one; on today's
narrow row the site is what is shared.

**Wording.** Buttons: "Share", "Copy link", "Copy address". Feedback: "Link copied", "Address
copied". A failed share: "Could not share" with *Copy link*. A failed copy: "Could not copy —
select the text instead". Every control is a native `<button>` or
`<a>` reachable by keyboard and operable with Enter (and Space for a button).

## What this does not settle

- Whether a place gets a full view of its own (#875, #878); the controls above are shared
  components so they move with it.
- What a shared link looks like when it arrives (#1196): a messenger draws its preview from the
  page's own metadata (a title and a picture in Open Graph tags), which the card's address does not
  carry today; the *Share* above sends the link that preview will be drawn for.
- The data under the Belfries' points: a point named "Stadhuis met Belfort" with no town is a
  naming question for the catalogue, not for the card.
- Phone behaviour was read from the products' documentation and the platform's, not tested on
  devices; the press-duration threshold is the cited article's, not measured here.
