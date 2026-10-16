/**
 * Whether a click on `element` is the end of a text selection inside it (#1190).
 *
 * A drag across a card's title to select "Groeningemuseum" ends in a click on
 * the row, and the row's click opens and closes the card: the visitor selected
 * the name and lost the card in one gesture. A click that leaves a non-empty
 * selection reaching into the element is a selection, not a toggle; a plain
 * click, which collapses any selection to a caret, still toggles.
 */
export function endsTextSelectionIn(element: Element): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.toString().trim() === '') return false;
  // `intersectsNode` and not `containsNode(element, true)`: a range that lies wholly
  // inside the row is not "partially contained" by it in the DOM's sense.
  for (let i = 0; i < selection.rangeCount; i++) {
    if (selection.getRangeAt(i).intersectsNode(element)) return true;
  }
  return false;
}
