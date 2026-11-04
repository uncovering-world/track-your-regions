# ADR-0182: A picture's credit is as large as its surface, and none where the licence asks none

**Date:** 2026-11-04
**Status:** Accepted

---

## Context

Every picture the catalogue shows is a Wikimedia Commons file
([ADR-0043](0043-a-picture-we-show-is-one-we-may-show.md)), and until this decision every one
carried a full credit line under it, `Author · Licence`, drawn by `ImageCreditLine`. The line was
often heavier than the place it credited. Measured on the development database on 2026-11-04
(#2346):

- Of the 19,908 places that hold a picture, 14,021 (70 %) showed a credit longer than the place's
  name, and 5,075 a credit more than twice as long. The median credit was 26 characters against a
  19-character name, and the longest 219.
- Of the 1,822 works with a picture, the credit was longer than the name on 1,390.
- 2,743 of the places' pictures and 1,454 of the works' are public domain or CC0.

Commons' free-form author field also reached the line raw. 35 credits showed literal markup, such as
`<a class="external text" …`. The input cap of 2 kB cut a template's markup inside a tag that no
`>` closed (Santa Maria in Vallicella), and an escaped tag was decoded after the tags were stripped.
19 credits held an e-mail address and 171 a URL. The Phuktal, Stongdey, Karsha and Chellah pictures
read "This Photo was taken by Timothy A. Gonsalves . Feel free to use my photos … send me an
email …". Mount Fuji's began "Public domain Public domain false false I, the copyright holder…".
The Ipatiev Monastery's read "Please credit this with : Photo : Anton Zelenov".

What the licences ask:

- **CC BY and CC BY-SA 4.0**, § 3(a)(2): the attribution may be given "in any reasonable manner
  based on the medium, means, and context", including by a link to a page that holds it.
- **The 2.0 to 3.0 licences**: a credit "reasonable to the medium or means".
- **Public domain and CC0**: nothing. Commons says so per file in `extmetadata`:
  `AttributionRequired` is `false` for both.

Wikipedia and Wikivoyage show thumbnails with no credit beside them. They link the Commons file
page, where Media Viewer gives the author and the licence.

The full line under every thumbnail was the catalogue's own choice. It was stated in CLAUDE.md
§ Experience Images ("Anything new that displays … a picture shows the credit with it") and in
`ImageCreditLine`, not in a licence and not in an ADR. ADR-0043 fixes where a picture comes from
and names the credit's obligation in its context, not how the credit is drawn. ADR-0040 decision 6
and ADR-0049 bind a curator's picture write to its credit. ADR-0151 and ADR-0099 decide when a
credit passes the gate. None of them holds a rule about the drawing, so this decision narrows no
ADR.

## Decision

**1. The credit is as large as the surface the picture sits on.** `ImageCreditLine` takes the
surface (`surface`):

- **A dense row** (`badge`) is a review card's list, the crowded-city window, a works grid or
  preview, or a picker's tiles. The credit is a small © badge on the thumbnail. It is a button, so a
  touch and a keyboard reach it. It opens a popover with the full credit and a link to the file page,
  and Escape or a click outside closes it.
- **A card** (`line`) is the place card, the hover cards or a curator's preview. The credit is one
  line, "© Author · Licence", cut with an ellipsis. The whole text shows on hover and on focus. The
  author links to the file page and the licence to its terms.
- **A full-size view** (`full`) is an enlargement or the preview over the map. The credit is the
  whole of it, wrapping.

**2. A press on a dense row's thumbnail opens the picture enlarged.** A 64 px thumbnail tells a
curator little about which building it is. Clicking the thumbnail, or pressing Enter or Space on it,
opens it in a dialog at 960 px, a width Wikimedia's CDN holds (`Special:FilePath?width=960`). The
full credit is under it. Escape closes the dialog. The enlargement is a full-size view in the sense
of decision 1. The one dialog that draws it (`PictureLightbox`) is also the review card's
enlargement. A works preview inside a tooltip carries the badge without the enlargement, since the
tooltip closes as the pointer leaves.

**3. A picture whose licence asks no credit shows none, on any surface.** Commons'
`AttributionRequired` decides. It is stored on the credit as `attributionRequired`. A credit stored
before it was read has no flag, and the licence's name decides there: public domain, `PD-`, `PDM`
and CC0 ask none, and every other name is read as asking one. Over-crediting costs a line, and
under-crediting breaks the one term CC BY imposes.

**4. The credit uses what the photographer asked for, and the author is read as a name.** The run
reads Commons' `Attribution` (the `attribution=` the licence template was given) and uses it where
it is given. The licence and the addresses that come with it are dropped, since the line names the
licence and links the file page itself. Otherwise `Artist` is read:

- entities are decoded before tags are stripped, and a tag the input cap cut open is dropped;
- the licence's hidden cells go;
- a template's sentence gives its name ("was taken by Timothy A. Gonsalves");
- e-mail addresses and URLs go, together with the sentences and parts of them about terms and wishes.

An author nothing can be read from is none. The line then points at the file page ("Author on the
file page"), where Commons states the author in full. The link is the credit CC 4.0 accepts.

**5. The other credits are not changed.** The OpenStreetMap credit an outline carries (ADR-0059
decision 3, the OSMF guideline) and the UNESCO credit a description carries (ADR-0149 decision 3)
stay as they are. Both are visible without interaction, near what they credit.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the full line everywhere and shorten it | A shorter line is still a line under every 64 px thumbnail of a review card's list, and a cut name credits nobody. The licences ask for a reasonable credit, not this one. |
| Show no credit and link the file page from the picture, as Wikipedia does | The product is not Wikipedia. A reader on a card does not know a press on the picture leads to the photographer, and a card has room for the line. |
| A credit on hover only | A touch screen has no hover, and the badge would then be unreachable there. |
| Keep the dense rows' rule that hid a credit repeating the maker the row names (`creditAddsBeyond`) | With decision 3 it hides nothing. A free licence draws no credit at all, and the rule never hid a credit owed. It is deleted. |

## Consequences

**Positive:**
- A card's credit takes one line and a dense row's takes a 16 px badge, so the place leads again.
- 2,743 places' pictures and 1,454 works' show no credit, as their licences allow.
- The author reads as a name. Run over the 11,520 distinct authors stored on 2026-11-04, the
  reading changed 747 of them. 42 became none: bare URLs, e-mail addresses and licence text. It
  was idempotent on every one, so a resent credit does not change twice.
- A dense row's picture can be looked at, at 960 px, with its credit.

**Negative / Trade-offs:**
- The badge's credit takes a press to read. CC 4.0's "reasonable manner" allows it, and the 2.0 to
  3.0 licences' "reasonable to the medium" too, for a thumbnail in a list. On a card, the line stays.
- The author reading is a heuristic over free text. A collage's file names ("Lednice (Eisgrub) -
  zámek.JPG : Marcin Szala …") still read as they are, and a field it cannot read falls back to the
  file page.
- A run that re-reads its credits records a metadata change for most of them once, since the stored
  credit gains `attributionRequired`. On a gated source this passes the gate as the same file's
  credit (ADR-0099), because the licence is unchanged.

## References

- Related ADRs: ADR-0043 (where a picture comes from), ADR-0059 decision 3 and ADR-0149 decision 3
  (the credits this does not change), ADR-0099 and ADR-0151 (a credit at the gate).
- Related docs: `CLAUDE.md` § Experience Images, `docs/tech/shared-frontend-patterns.md`
  (`ImageCreditLine`, `DenseThumbnail`, `PictureLightbox`), `docs/tech/experiences.md`
  § Picture credits.
- Issue: #2346.
