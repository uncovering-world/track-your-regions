/**
 * Linkify region names mentioned in AI-generated text.
 *
 * Walks a React children tree (typically the output of react-markdown), scans
 * every text node for substrings that match the supplied region-name regex,
 * and replaces matches with clickable spans that call back into the tree
 * navigation. Non-text nodes are passed through unchanged.
 *
 * Used by the AI Review Drawer (rebuild/30 — AI management layer) so
 * paragraph/list/heading/strong markdown elements can deep-link into the
 * import-review tree without changing the AI's prompt format.
 */

import { Children, type ReactNode } from 'react';

export function linkifyRegionNames(
  children: ReactNode,
  regex: RegExp,
  nameToId: Map<string, number>,
  onClick: (regionId: number) => void,
): ReactNode {
  return Children.map(children, (child, idx) => {
    if (typeof child !== 'string') return child;

    regex.lastIndex = 0;
    const matches = child.match(regex);
    if (!matches || matches.length === 0) return child;

    const parts: ReactNode[] = [];
    let cursor = 0;
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const start = child.indexOf(match, cursor);
      if (start < 0) continue;
      if (start > cursor) parts.push(child.slice(cursor, start));
      const regionId = nameToId.get(match);
      if (regionId !== undefined) {
        parts.push(
          <a
            key={`rn-${idx}-${start}`}
            role="button"
            tabIndex={0}
            style={{
              color: 'rgb(21,101,192)',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
            onClick={(e) => { e.preventDefault(); onClick(regionId); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick(regionId);
              }
            }}
          >
            {match}
          </a>,
        );
      } else {
        parts.push(match);
      }
      cursor = start + match.length;
    }
    if (cursor < child.length) parts.push(child.slice(cursor));
    return parts.length > 0 ? parts : child;
  });
}
