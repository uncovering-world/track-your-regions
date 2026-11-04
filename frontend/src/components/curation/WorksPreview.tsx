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

import { Box, Link, Stack, Tooltip, Typography } from '@mui/material';
import { wikidataItemUrl, wikipediaArticleUrl } from '../../utils/wikidataLinks';
import { DenseThumbnail } from '../shared/DenseThumbnail';
import { creatorsBrief } from '../../utils/creatorList';
import { yearLabel } from '../../utils/yearLabel';
import type { CountedWork } from '../../api/reviewQueue';

// A counted work is the queue's own `CountedWork`, which the review queue's
// answer declares (ADR-0066).
export type { CountedWork };

/**
 * "statue · Polykleitos · 450 BC" — what it is, who made it, when.
 *
 * Antiquities are what these lists are mostly made of, so the era is written out on both
 * sides of zero — `yearLabel`'s rule, the one spelling every surface that shows a
 * work's year uses (#731).
 */
function subtitle(work: CountedWork): string {
  const parts: string[] = [];
  if (work.type) parts.push(work.type);
  // The brief form: these rows sit in a tooltip, and the Moon Museum's six
  // names would push the type and the era off the end of it.
  const makers = creatorsBrief(work.artists, work.artistsCurated);
  if (makers) parts.push(makers);
  const when = yearLabel(work.year);
  if (when) parts.push(when);
  return parts.join(' · ');
}

/**
 * One work, as every surface that shows a work to a curator draws it: the
 * picture at thumbnail size, the name linked to where it came from, what it is,
 * who made it, when. Exported for the held card's part preview (ADR-0037), which
 * opens a work the same way this list shows one.
 */
export function WorkCard({ work }: { work: CountedWork }) {
  const line = subtitle(work);
  // Where a work goes when a curator does not recognise it. The preview showed a
  // thumbnail and stopped, which answers "what does it look like" and not "what is
  // it" — and the second is the question a name like *Venus of Dolní Věstonice*
  // raises. Every treasure carries the id it was imported under, a Wikidata item, so
  // the page it came from is one link away — and the article is a second one, resolved
  // by Wikidata at the click rather than stored: the works writer never asks for an
  // article, and 50 of 50 sampled works had an English one (#806). On the rare miss the
  // link lands on Wikidata's own "no page found for that combination" form, not a 404,
  // with the item itself linked from the name beside it.
  const link = wikidataItemUrl(work.externalId);
  const article = wikipediaArticleUrl(work.externalId);
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      {/* The picture at thumbnail size, its credit the badge on it (ADR-0182). Not
          opened enlarged here: these rows live inside a tooltip, which closes as
          the pointer leaves and would take a dialog opened from it along. */}
      <DenseThumbnail imageUrl={work.imageUrl} title={work.name} credit={work.imageCredit} width={48} height={48}
        enlarge={false} />
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
        {(line || article) && (
          <Typography variant="caption" component="div">
            {/* Its own element, so the line stays one text node beside the link. */}
            {line && <span>{line}</span>}
            {line && article && ' · '}
            {article && (
              // Named for the work: a refusal's preview holds up to twelve of these,
              // and a screen reader's link list of twelve bare "Wikipedia"s says
              // nothing about which one opens what. The visible text leads the name.
              <Link
                href={article}
                target="_blank"
                rel="noopener noreferrer"
                color="inherit"
                aria-label={`Wikipedia article for ${work.name}`}
              >
                Wikipedia
              </Link>
            )}
          </Typography>
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
