/**
 * The deeper levels of the coverage gap tree, read as the reviewer expands
 * them (#1030). The coverage answer carries one level under each gap; a node
 * below that is read here, through the GADM subdivisions route, once.
 */

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchSubdivisions } from '../../api/divisions';
import { queryKeys } from '../../api/queryKeys';
import type { GapChild } from '../../api/admin/worldViewImport';
import type { LoadedGapChildren } from './coverageResolveUtils';

/** GADM's own hierarchy, which the gaps are divisions of. */
const GADM_WORLD_VIEW_ID = 1;

/**
 * The route's largest page. No GADM division has more children than this
 * (897 on 2026-09-28), so one page is every child.
 */
const CHILDREN_PAGE = 1000;

export function useGapChildren(): {
  loaded: LoadedGapChildren;
  /** The divisions whose level could not be read, until a retry reads it. */
  failed: ReadonlySet<number>;
  /** Read the divisions under `divisionId`, once; a failed read is asked again on the next call. */
  ensureLoaded: (divisionId: number) => void;
} {
  const queryClient = useQueryClient();
  const [loaded, setLoaded] = useState<LoadedGapChildren>(new Map());
  const [failed, setFailed] = useState<ReadonlySet<number>>(new Set());
  const asked = useRef(new Set<number>());

  const ensureLoaded = useCallback((divisionId: number) => {
    if (asked.current.has(divisionId)) return;
    asked.current.add(divisionId);
    // A retry shows "Loading…" while it runs, not the failure it is retrying.
    setFailed((prev) => withoutId(prev, divisionId));
    queryClient.fetchQuery({
      queryKey: queryKeys.divisions.children(GADM_WORLD_VIEW_ID, divisionId),
      queryFn: () => fetchSubdivisions(divisionId, GADM_WORLD_VIEW_ID, { limit: CHILDREN_PAGE }),
    }).then((divisions) => {
      const children: GapChild[] = divisions.map(({ id, name, hasChildren }) => ({ id, name, hasChildren }));
      setLoaded((prev) => new Map(prev).set(divisionId, children));
    }).catch((err: unknown) => {
      asked.current.delete(divisionId);
      setFailed((prev) => new Set(prev).add(divisionId));
      console.error('Failed to read the divisions under %d:', divisionId, err);
    });
  }, [queryClient]);

  return { loaded, failed, ensureLoaded };
}

function withoutId(ids: ReadonlySet<number>, id: number): ReadonlySet<number> {
  if (!ids.has(id)) return ids;
  const next = new Set(ids);
  next.delete(id);
  return next;
}
