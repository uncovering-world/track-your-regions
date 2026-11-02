/**
 * A Wikipedia link in the reader's language (#2209).
 *
 * The catalogue links one English article per place, part and work. A reader
 * who reads another language first is offered the same item's article in the
 * first of their languages it has: `useReaderEdition` asks for it, and the
 * link's words say which edition it opens — "Wikipedia (ru)" — since a reader
 * who chose Russian and German should see which one they got. Where the item
 * has none ahead of English, or while the answer is on its way, the English
 * link stands as it always did. Only English Wikipedia articles are asked
 * about; any other address is left as it is.
 *
 * A curator's screens keep the English article as the reference, since that is
 * what the catalogue holds and what a review row proposes, and offer the
 * reader's edition beside it (`ReaderEditionBeside`).
 */

import { useEffect, useState } from 'react';
import { Link } from '@mui/material';
import { fetchReaderEdition, type ReaderEdition } from '../../api/wikipediaEditions';
import { useReadingLanguages } from '../../hooks/useReadingLanguages';
import { safeHref } from '../../utils/safeHref';

const ENGLISH_ARTICLE = /^https:\/\/en\.wikipedia\.org\/wiki\/[^?#]+$/;

/**
 * Each article's answer for each list of languages, for the page's life: an
 * edition does not change while a page is open, and a list scrolled back into
 * view asks nothing. A failed read is forgotten, so the next render asks again.
 * Kept here rather than in the query cache, so a link renders anywhere, a
 * provider or none.
 */
const answers = new Map<string, Promise<ReaderEdition | null>>();

/** The article's edition in the reader's first language ahead of English, or null for its English link. */
export function useReaderEdition(article: string | null | undefined): ReaderEdition | null {
  const { order } = useReadingLanguages();
  const english = article && ENGLISH_ARTICLE.test(article) ? article : null;
  const languages = order.slice(0, order.indexOf('en')).join(',');
  const key = english && languages ? `${languages}|${english}` : null;
  const [answer, setAnswer] = useState<{ key: string; edition: ReaderEdition | null } | null>(null);
  useEffect(() => {
    if (!key || !english) return undefined;
    let live = true;
    let asked = answers.get(key);
    if (!asked) {
      asked = fetchReaderEdition(english, languages.split(',')).catch(() => {
        answers.delete(key);
        return null;
      });
      answers.set(key, asked);
    }
    asked.then((edition) => { if (live) setAnswer({ key, edition }); }, () => undefined);
    return () => { live = false; };
  }, [key, english, languages]);
  return answer && answer.key === key ? answer.edition : null;
}

/** "Wikipedia", or "Wikipedia (ru)" for an edition in another language. */
export function wikipediaWords(edition: ReaderEdition | null): string {
  return edition ? `Wikipedia (${edition.language})` : 'Wikipedia';
}

/** The reader's edition of an English article, as a small link beside it on a curator's screen; nothing where it is English. */
export function ReaderEditionBeside({ article }: { article: string | null | undefined }) {
  const edition = useReaderEdition(article);
  const href = safeHref(edition?.url ?? null);
  if (!edition || !href) return null;
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer" variant="caption" underline="hover"
      aria-label={`The same article in ${edition.language}`}>
      {`(${edition.language})`}
    </Link>
  );
}
