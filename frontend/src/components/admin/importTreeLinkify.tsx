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

/** Recursively process React children to replace region name strings with clickable links */
export function linkifyRegionNames(
  children: ReactNode,
  regex: RegExp,
  nameToId: Map<string, number>,
  onNavigate: (regionId: number) => void,
): ReactNode {
  return flatMapChildren(children, (text) => {
    regex.lastIndex = 0;
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const name = match[1];
      const regionId = nameToId.get(name);
      if (regionId == null) continue;
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      parts.push(
        <span
          key={`${regionId}-${match.index}`}
          role="button"
          tabIndex={0}
          onClick={() => onNavigate(regionId)}
          onKeyDown={(e) => { if (e.key === 'Enter') onNavigate(regionId); }}
          style={{ color: '#1976d2', cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: '2px' }}
        >
          {name}
        </span>,
      );
      lastIndex = regex.lastIndex;
    }
    if (parts.length === 0) return text;
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
  });
}
