/**
 * Shared scroll-to-element utilities.
 *
 * Provides consistent scroll behaviour for centering or top-aligning
 * elements within a scrollable container.
 */

/**
 * Scroll so that `element` is vertically centered in `container`.
 */
export function scrollToCenter(container: HTMLElement, element: HTMLElement): void {
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const elementRelativeTop = elementRect.top - containerRect.top + container.scrollTop;
  const scrollTarget = elementRelativeTop - container.clientHeight / 2 + element.offsetHeight / 2;

  container.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' });
}

/**
 * Scroll so that `element` is at the top of `container` with a small gap.
 */
export function scrollToTop(container: HTMLElement, element: HTMLElement, padding = 8): void {
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const elementRelativeTop = elementRect.top - containerRect.top + container.scrollTop;
  const scrollTarget = elementRelativeTop - padding;

  container.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' });
}
