/**
 * What a picture on a review card is, where it is not a photograph (#2192).
 *
 * A place's picture is meant to show the place and a work's picture the work,
 * and the card drew a map or an engraving exactly as it drew a photograph:
 * Banqiao Dam's picture is a map, Larsa's a map of Hammurabi's Babylonia, and a
 * run proposed an 1865 engraving for the Saqqara Tablet beside its photograph.
 * A curator choosing between two pictures had nothing that said one of them was
 * not a photograph. The mark says it, on both sides of a picture question, with
 * what Commons decided it by one hover away; a photograph, and a picture
 * Commons gave nothing to class by, get no mark.
 *
 * The classes are the backend's (`getPictureClasses`), one request per card,
 * asked once a marked picture is near the screen (`useNearViewport`), so a page
 * of cards asks about the ones a curator scrolls to and never the whole queue.
 */

import { useRef } from 'react';
import { Tooltip, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { getPictureClasses, type PictureClassResult } from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';
import { useNearViewport } from '../../hooks/useNearViewport';

const NOT_A_PHOTOGRAPH: Partial<Record<NonNullable<PictureClassResult['class']>, string>> = {
  map: 'a map, not a photograph',
  drawing: 'a drawing or engraving, not a photograph',
  diagram: 'a diagram, not a photograph',
};

/** The words beside a classed picture, or null for a photograph and for a picture not classed. */
export function classWords(result: Pick<PictureClassResult, 'class'> | undefined): string | null {
  return result?.class ? NOT_A_PHOTOGRAPH[result.class] ?? null : null;
}

/**
 * The mark under the picture `url` of a card about the place `experienceId`.
 * A caller without the place's id draws no mark: there is nothing to ask.
 */
export function PictureClassMark({ experienceId, url }: { experienceId: number; url: string | null | undefined }) {
  const box = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(box);
  const { data } = useQuery({
    queryKey: queryKeys.experience.pictureClasses(experienceId),
    queryFn: () => getPictureClasses(experienceId),
    enabled: near && !!url,
    // The backend keeps an answer for a day; an hour here spares the request.
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const result = url ? data?.classes.find(one => one.url === url) : undefined;
  const words = classWords(result);
  return (
    <Typography component="span" ref={box} variant="caption" color="warning.main" display="block">
      {words && (
        <Tooltip title={`Commons files it under “${result?.basis ?? ''}”. The picture is meant to show the place or the work itself.`} describeChild>
          <span>{words}</span>
        </Tooltip>
      )}
    </Typography>
  );
}
