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

import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { toThumbnailUrl } from '../../utils/imageUrl';

export interface CountedWork {
  name: string;
  type: string | null;
  artist: string | null;
  imageUrl: string | null;
  year: number | null;
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
  if (work.artist) parts.push(work.artist);
  if (typeof work.year === 'number') {
    if (work.year < 0) parts.push(`${Math.abs(work.year)} BC`);
    else parts.push(work.year < 1000 ? `AD ${work.year}` : String(work.year));
  }
  return parts.join(' · ');
}

function WorkRow({ work }: { work: CountedWork }) {
  const line = subtitle(work);
  // The normalised URL decides whether there is a picture at all: `toThumbnailUrl` answers
  // with an empty string for a host we do not trust, and `src=""` is not "no image" — the
  // browser resolves it against the page and draws a broken thumbnail. Every treasure image
  // stored today is on commons.wikimedia.org, so this guards the next source, not this one.
  const thumbnail = work.imageUrl ? toThumbnailUrl(work.imageUrl, 120) : '';
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
        />
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" component="div" sx={{ fontWeight: 600 }}>{work.name}</Typography>
        {line && <Typography variant="caption" component="div">{line}</Typography>}
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
          {named.map(work => <WorkRow key={work.name} work={work} />)}
          {named.length > 0 && rest.length > 0 && (
            <Typography variant="caption" color="inherit" sx={{ pt: 0.5 }}>
              Also kept here, less widely known:
            </Typography>
          )}
          {rest.map(work => <WorkRow key={work.name} work={work} />)}
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
