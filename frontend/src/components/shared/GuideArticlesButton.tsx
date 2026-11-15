/**
 * A guide's yes that opens the Wikivoyage articles behind it (#2520).
 *
 * Wherever a curator's screen says a Wikivoyage guide uses a place (the
 * crowded-city figures' *In Wikivoyage*, a visit question's travel-guide
 * witness), the words are a button. It opens a popover that lists every
 * article of every edition that uses the item the evidence was read for: the
 * article's title, its language and a link to it on its own edition.
 *
 * The list is read when the popover opens, from the copy the server keeps, so
 * a table of a hundred places asks nothing until a curator does. It answers
 * four ways apart: reading, a failure, no article, and a copy built before the
 * articles were kept. The last never reads as "no guide uses it": the yes was
 * measured, and only its articles are not listed yet.
 *
 * A button rather than a hover, so a touch screen and a keyboard reach it.
 * Escape, a click outside or the close button closes it, and the focus goes
 * back to the button. Every click and key inside it stops at it: the rows it
 * sits in answer a click or a key of their own (a queue row is chosen or
 * ticked, a crowded-city row opens its place), and a popover's events reach
 * the row through React even from its portal.
 */

import { useId, useState, type MouseEvent, type SyntheticEvent } from 'react';
import { Box, Button, CircularProgress, IconButton, Link, Popover, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useQuery } from '@tanstack/react-query';
import { fetchGuideArticles, type GuideArticles } from '../../api/guideArticles';
import { queryKeys } from '../../api/queryKeys';
import { languageName } from '../../utils/readingLanguages';
import { safeHref } from '../../utils/safeHref';

/** How long an answer is reused when the popover opens again: the copy changes once a build swaps in. */
const STALE_MS = 10 * 60_000;

const stop = (event: SyntheticEvent) => event.stopPropagation();

/** A count of articles in words: "1 article", "12 articles". */
const articlesWord = (count: number) => `${count.toLocaleString('en')} ${count === 1 ? 'article' : 'articles'}`;

/** One article: its title, linked to its edition, and the edition's language. */
function ArticleLine({ article }: { article: GuideArticles['articles'][number] }) {
  const href = safeHref(article.url);
  const title = <span lang={article.language}>{article.title}</span>;
  return (
    <Box component="li" sx={{ py: 0.5 }}>
      {href ? (
        <Link href={href} target="_blank" rel="noopener noreferrer" underline="hover" variant="body2" onClick={stop}>
          {title}
        </Link>
      ) : <Typography variant="body2" component="span">{title}</Typography>}
      <Typography variant="caption" color="text.secondary" component="div">
        {`${languageName(article.language)} Wikivoyage`}
      </Typography>
    </Box>
  );
}

/** What the read answered, said as one of its states. */
function ArticlesAnswer({ answer }: { answer: GuideArticles }) {
  if (!answer.articlesKept) {
    return (
      <Typography variant="body2" data-testid="guide-articles-not-kept">
        The articles are not listed yet. The Wikivoyage data in place predates article titles, so this does not mean no
        guide uses it. They appear once an admin updates the Wikivoyage item usage on the Public Dumps page.
      </Typography>
    );
  }
  if (answer.articles.length === 0) {
    return (
      <Typography variant="body2" data-testid="guide-articles-none">
        {answer.item === null
          ? 'This place has no Wikidata item, so no Wikivoyage article is linked to it.'
          : 'No article in the Wikivoyage data in place uses this place now. The yes was read from older data.'}
      </Typography>
    );
  }
  return (
    <>
      <Typography variant="body2" sx={{ mb: 0.5 }}>{`Used in ${articlesWord(answer.articles.length)}:`}</Typography>
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', maxHeight: 280, overflowY: 'auto' }} tabIndex={0}
        aria-label="Wikivoyage articles">
        {answer.articles.map(article => <ArticleLine key={article.url} article={article} />)}
      </Box>
      {answer.truncated && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
          {`Only the first ${articlesWord(answer.articles.length)} are listed.`}
        </Typography>
      )}
    </>
  );
}

/** The popover's body: read when it opens, and said as reading, failed or answered. */
function ArticlesBody({ membershipId }: { membershipId: number }) {
  const read = useQuery({
    queryKey: queryKeys.curation.guideArticles(membershipId),
    queryFn: () => fetchGuideArticles(membershipId),
    staleTime: STALE_MS,
    retry: false,
  });
  if (read.isPending) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" role="status">
        <CircularProgress size={16} />
        <Typography variant="body2">Reading the Wikivoyage articles…</Typography>
      </Stack>
    );
  }
  if (read.isError) {
    return (
      <Box role="alert">
        <Typography variant="body2">The articles could not be read.</Typography>
        <Button size="small" onClick={() => read.refetch()} disabled={read.isFetching} sx={{ mt: 0.5, ml: -0.5 }}>
          Try again
        </Button>
      </Box>
    );
  }
  return <ArticlesAnswer answer={read.data} />;
}

export function GuideArticlesButton({ membershipId, placeName, children }: {
  /** The membership whose item the guide evidence was read for. */
  membershipId: number;
  /** The place, for the button's and the popover's names. */
  placeName: string;
  /** The words that say a guide uses the place: "yes", "a travel guide lists it". They begin the button's name. */
  children: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const popoverId = useId();
  const headingId = useId();
  const open = anchor !== null;
  return (
    <>
      <Link
        component="button"
        type="button"
        color="inherit"
        underline="always"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={`${children}, the Wikivoyage articles about ${placeName}`}
        onClick={(event: MouseEvent<HTMLElement>) => {
          event.stopPropagation();
          setAnchor(event.currentTarget);
        }}
        onKeyDown={stop}
        sx={{ font: 'inherit', verticalAlign: 'baseline', textDecorationStyle: 'dotted' }}
      >
        {children}
      </Link>
      <Popover
        id={popoverId}
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        onClick={stop}
        onKeyDown={stop}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-labelledby': headingId,
            sx: { p: 1.5, width: 320, maxWidth: 'calc(100vw - 32px)' },
          },
        }}
      >
        <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ mb: 1 }}>
          <Typography id={headingId} variant="subtitle2" sx={{ flex: 1, minWidth: 0 }}>
            {`Wikivoyage articles about ${placeName}`}
          </Typography>
          <IconButton size="small" aria-label="Close" onClick={() => setAnchor(null)} sx={{ mt: -0.5, mr: -0.5 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
        <ArticlesBody membershipId={membershipId} />
      </Popover>
    </>
  );
}
