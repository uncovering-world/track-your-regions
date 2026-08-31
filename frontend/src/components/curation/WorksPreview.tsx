/**
 * The works a refusal counted, shown rather than counted at.
 *
 * "None of the 5 famous works listed here is a painting" asks a curator to trust a number
 * about things they cannot see. Five Iberian stone ladies, with their pictures, answer the
 * question the sentence raises — *what sort of place is this* — before anyone reads a word
 * of the rule.
 *
 * Hung on the phrase itself, not on a separate icon: the count is what raises the doubt,
 * so the count is what answers it. The question mark beside it keeps the rule's reasoning,
 * which is a different question and a longer read.
 */

import { useState } from 'react';
import { Box, Link, Stack, Tooltip, Typography } from '@mui/material';
import { toThumbnailUrl } from '../../utils/imageUrl';
import { ImageCreditLine } from '../shared/ImageCreditLine';
import { creatorsBrief } from '../../utils/creatorList';
import type { ImageCredit } from '../../api/experiences';

export interface CountedWork {
  name: string;
  type: string | null;
  /** Every maker the source names, in no asserted order. Empty where none is recorded (#720). */
  artists: string[];
  /** Whether a curator has vouched for that order (ADR-0040). */
  artistsCurated: boolean;
  imageUrl: string | null;
  /** Whose photograph of the work this is, when the run managed to ask. */
  imageCredit?: ImageCredit | null;
  year: number | null;
  /**
   * The source's own id — a Wikidata QID for every work in the catalogue.
   *
   * Not optional and not nullable, because `treasures.external_id` is
   * `NOT NULL UNIQUE`: it is the identity the works upsert conflicts on, and it is
   * what keys these rows below. A fallback to the name would be the unsafe key the
   * row's own comment argues against.
   */
  externalId: string;
}

/**
 * Where a work goes when a curator does not recognise it.
 *
 * The preview showed a thumbnail and stopped, which answers "what does it look like" and
 * not "what is it" — and the second is the question a name like *Venus of Dolní Věstonice*
 * raises. Every treasure here carries the id it was imported under, and that id is a
 * Wikidata entity, so the page it came from is one link away.
 */
function sourceLink(work: CountedWork): string | null {
  return /^Q\d+$/.test(work.externalId)
    ? `https://www.wikidata.org/wiki/${work.externalId}`
    : null;
}

/**
 * "statue · Polykleitos · 450 BC" — what it is, who made it, when.
 *
 * Antiquities are what these lists are mostly made of, so the era is written out on both
 * sides of zero: "statue · 200" beside "statue · 200 BC" reads as a typo rather than as
 * four hundred years apart.
 */
function subtitle(work: CountedWork): string {
  const parts: string[] = [];
  if (work.type) parts.push(work.type);
  // The brief form: these rows sit in a tooltip, and the Moon Museum's six
  // names would push the type and the era off the end of it.
  const makers = creatorsBrief(work.artists, work.artistsCurated);
  if (makers) parts.push(makers);
  if (typeof work.year === 'number') {
    if (work.year < 0) parts.push(`${Math.abs(work.year)} BC`);
    else parts.push(work.year < 1000 ? `AD ${work.year}` : String(work.year));
  }
  return parts.join(' · ');
}

/**
 * One work, as every surface that shows a work to a curator draws it: the
 * picture at thumbnail size, the name linked to where it came from, what it is,
 * who made it, when. Exported for the held card's part preview (ADR-0037), which
 * opens a work the same way this list shows one.
 */
export function WorkCard({ work }: { work: CountedWork }) {
  // A plain flag is safe wherever the parent keys the child, as it does here — by
  // the work's own id — `NOT NULL UNIQUE` in the schema, so there is no fallback
  // to write — and a different work is therefore a different instance that cannot
  // inherit this one's refusal. The *name* would not do: `treasures.name` is a
  // Wikidata label with no uniqueness about it, and this list is a museum's
  // best-known dozen, which is exactly where labels collide — the Getty holds two
  // works called `Spring` inside its twelve. Keyed by name, a duplicate would let
  // one of them take the other's refusal: a picture that loaded, credited under a
  // frame that did not, which is the inversion the flag exists to prevent. The
  // surfaces that hold *one* instance across many pictures — the hover cards, the
  // queue card, its publish preview, the map overlay — remember which URL failed
  // instead.
  const [failed, setFailed] = useState(false);
  const line = subtitle(work);
  const link = sourceLink(work);
  // The normalised URL decides whether there is a picture at all: `toThumbnailUrl` answers
  // with an empty string for a host we do not trust, and `src=""` is not "no image" — the
  // browser resolves it against the page and draws a broken thumbnail. Every treasure image
  // stored today is on commons.wikimedia.org, so this guards the next source, not this one.
  const thumbnail = work.imageUrl && !failed ? toThumbnailUrl(work.imageUrl, 120) : '';
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      {thumbnail && (
        // A plain <img> and a thumbnail width, as everywhere an experience's picture is
        // shown: these are remote Wikimedia URLs, and asking for the full file to draw it
        // at 48 pixels would fetch megabytes per hover.
        <Box
          component="img"
          src={thumbnail}
          alt=""
          loading="lazy"
          sx={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }}
          // Without this the frame keeps the browser's broken-image glyph with a
          // photographer's name under it, inside a tooltip a curator cannot
          // dismiss to check.
          onError={() => setFailed(true)}
        />
      )}
      <Box sx={{ minWidth: 0 }}>
        {/* The name opens where the work came from, when the id says where that is. The
            tooltip stays open while the pointer is inside it, so the link is reachable —
            and it opens in a new tab, because losing the queue to read about one sculpture
            would cost the curator their place in it. */}
        {link
          ? (
            <Link
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              variant="caption"
              color="inherit"
              sx={{ fontWeight: 600, display: 'block' }}
            >
              {work.name}
            </Link>
          )
          : <Typography variant="caption" component="div" sx={{ fontWeight: 600 }}>{work.name}</Typography>}
        {line && <Typography variant="caption" component="div">{line}</Typography>}
        {/* The line above already names the artist, and Commons names the painter
            as the author of a photograph of a painting — so this draws only where
            it carries something the row does not: a licence asking to be honoured,
            or a photographer who is none of the makers. Hung on the thumbnail, since a
            name under no picture credits nobody for nothing.
            `color="inherit"` because these rows live inside a `Tooltip` and nowhere
            else: MUI's default tooltip is grey[700] at 92% with white text, this
            theme overrides none of it, and the component's own `text.secondary`
            would be near-black on near-black — the neighbouring `Typography`s take
            `color="inherit"` for the same reason. */}
        {thumbnail && (
          <ImageCreditLine credit={work.imageCredit} redundantWith={work.artists} color="inherit" />
        )}
      </Box>
    </Stack>
  );
}

export function WorksPreview({ works, total, held, only, children }: {
  works: CountedWork[] | null | undefined;
  /** How many the sentence claims, when it claims a number — see the note below. */
  total?: number;
  /**
   * How many the catalogue holds, for a sentence that claims no number.
   *
   * The two are different questions and can differ by one: the count in a sentence is what
   * the rule weighed at the time it ran, and this is what is stored now. Where the sentence
   * makes a claim, that claim is what the preview has to add up to; where it makes none —
   * a cathedral's names one work — this is the only thing that can notice the cap.
   */
  held?: number;
  /**
   * The one work the sentence names, when it names one rather than counts.
   *
   * A cathedral's line names the single work that pulled the building onto the list, and
   * the venue usually holds others. Hovering a work's name and getting an unlabelled list
   * of three reads as a contradiction, so the named one is shown as itself and the rest
   * under a heading that says what they are.
   */
  only?: string;
  children: React.ReactElement;
}) {
  // Without the works the phrase stays plain text: an underline promising a list that
  // never arrives is worse than no underline. Older servers send nothing here.
  if (!works || works.length === 0) return children;

  const named = only ? works.filter(work => work.name === only) : [];
  const rest = named.length > 0 ? works.filter(work => work.name !== only) : works;
  // The sentence's own claim first: where it makes one, that is what a curator will count
  // this list against. Where it makes none, what is stored is the only thing that can tell
  // a whole holding from the first page of one.
  const missing = (total ?? held ?? 0) - works.length;

  return (
    <Tooltip
      arrow
      placement="bottom-start"
      slotProps={{ tooltip: { sx: { maxWidth: 340, maxHeight: 420, overflowY: 'auto' } } }}
      title={(
        <Stack spacing={0.75} sx={{ py: 0.5 }}>
          {named.map(work => <WorkCard key={work.externalId} work={work} />)}
          {named.length > 0 && rest.length > 0 && (
            <Typography variant="caption" color="inherit" sx={{ pt: 0.5 }}>
              Also kept here, less widely known:
            </Typography>
          )}
          {rest.map(work => <WorkCard key={work.externalId} work={work} />)}
          {/* The card carries at most twelve, so a holding of more must not show twelve and
              stop: a curator counting them would think the number above was wrong. */}
          {missing > 0 && (
            <Typography variant="caption" color="inherit">
              …and {missing} more, the least widely known.
            </Typography>
          )}
        </Stack>
      )}
    >
      {children}
    </Tooltip>
  );
}
