/**
 * A Region chip's search (#1920): any region of a public world view, by name,
 * asked once the typing settles and the text is two characters or more. The
 * questions tab's chip and the crowded cities' (#2349) both search with it,
 * so the two find the same regions in the same words.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchReviewRegions } from '../../../api/reviewQueue';
import { queryKeys } from '../../../api/queryKeys';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import type { ChipSearch } from './FilterChip';
import { searchedRegionOption } from './toolbarOptions';

/** How long a search waits for the typing to stop, in ms. */
export const SEARCH_DEBOUNCE_MS = 300;

/** The chip's `search`, its found rows checked where they are the region picked. */
export function useRegionChipSearch(picked: number | 'none' | null): ChipSearch {
  const [text, setText] = useState('');
  const settled = useDebouncedValue(text, SEARCH_DEBOUNCE_MS).trim();
  const found = useQuery({
    queryKey: queryKeys.curation.reviewRegionSearch(settled),
    queryFn: () => searchReviewRegions(settled),
    enabled: settled.length >= 2,
    staleTime: 60_000,
  });
  return {
    value: text,
    onChange: setText,
    placeholder: 'Search a region',
    found: (found.data ?? []).map(region => searchedRegionOption(region, picked)),
    // Searching from the keystroke, not from the request: until the typing
    // settles nothing has been asked, and "nothing found" would be said of a
    // text never sent.
    searching: text.trim() !== settled || found.isFetching,
    nothingFound: 'No region by that name',
    failed: found.isError,
  };
}
