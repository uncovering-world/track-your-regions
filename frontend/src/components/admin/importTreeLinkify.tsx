/**
 * Linkify region names mentioned in AI-generated text.
 *
 * Walks a React children tree (typically the output of react-markdown), scans
 * every text node for substrings that match the supplied region-name regex,
 * and replaces matches with clickable spans that call back into the tree
 * navigation. Non-text nodes are recursed into, so nested elements
 * (e.g. <strong> inside <p>) are also processed.
 *
 * Used by:
 * - AIReviewDrawer (rebuild/30 — AI management layer): paragraph/list/heading/
 *   strong markdown elements deep-link into the import-review tree without
 *   changing the AI's prompt format.
 * - Overlap resolution and smart flatten preview dialogs (rebuild/33 — CV UI
 *   sections): region names in dialog copy link into the same tree.
 */

import { isValidElement, cloneElement, type ReactNode } from 'react';

/** Recursively process React children tree, applying fn to strings and recursing into elements */
export function flatMapChildren(
  children: ReactNode,
  fn: (child: string) => ReactNode | ReactNode[],
): ReactNode {
  if (children == null || typeof children === 'boolean') return children;
  if (typeof children === 'string') return fn(children);
  if (typeof children === 'number') return fn(String(children));
  if (isValidElement(children)) {
    const props = children.props as { children?: ReactNode };
    if (props.children != null) {
      return cloneElement(children, undefined, flatMapChildren(props.children, fn));
    }
    return children;
  }
  if (Array.isArray(children)) {
    const result: ReactNode[] = [];
    for (const child of children) {
      const mapped = flatMapChildren(child, fn);
      if (Array.isArray(mapped)) result.push(...mapped);
      else result.push(mapped);
    }
    return result;
  }
  return children;
}

/**
 * Recursively process React children to replace region-name substrings with
 * clickable links. The regex may be plain (full-match used as the name) or
 * have a single capture group (group 1 used as the name when present).
 *
 * Caveat: when a capture group is used, the captured text must be a contiguous
 * suffix-or-equal of `match[0]` for the highlighted span to align. We compute
 * `start` via `match[0].indexOf(match[1])`, which finds the FIRST occurrence —
 * fine for the current callers that use `\b(name)\b` (no prefix/suffix in
 * `match[0]`) but unreliable for regexes where the captured text could appear
 * earlier inside the full match (e.g. `/(test)test/`). Tighten the regex if
 * adding a new caller that doesn't fit this assumption.
 */
export function linkifyRegionNames(
  children: ReactNode,
  regex: RegExp,
  nameToId: Map<string, number>,
  onClick: (regionId: number) => void,
): ReactNode {
  return flatMapChildren(children, (text) => {
    regex.lastIndex = 0;
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    // Use a global-flag clone if the supplied regex isn't sticky/global so exec advances.
    // eslint-disable-next-line security/detect-non-literal-regexp -- regex.source comes from a trusted RegExp passed by the parent component, not user input
    const r = regex.global || regex.sticky ? regex : new RegExp(regex.source, `${regex.flags}g`);
    while ((match = r.exec(text)) !== null) {
      const name = match[1] ?? match[0];
      const start = match.index + (match[1] != null ? match[0].indexOf(match[1]) : 0);
      const regionId = nameToId.get(name);
      if (regionId == null) {
        // Avoid infinite loop on zero-length match
        if (match.index === r.lastIndex) r.lastIndex++;
        continue;
      }
      if (start > lastIndex) {
        parts.push(text.slice(lastIndex, start));
      }
      parts.push(
        <span
          key={`${regionId}-${start}`}
          role="button"
          tabIndex={0}
          onClick={() => onClick(regionId)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(regionId); } }}
          style={{ color: '#1976d2', cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: '2px' }}
        >
          {name}
        </span>,
      );
      lastIndex = start + name.length;
      // Avoid infinite loop on zero-length match
      if (match.index === r.lastIndex) r.lastIndex++;
    }
    if (parts.length === 0) return text;
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
  });
}
