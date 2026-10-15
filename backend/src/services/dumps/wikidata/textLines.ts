/**
 * The lines of a piece of dump text (#1479), as the read's line reader would
 * give them: split at each line feed, a carriage return before it dropped,
 * and no empty line after the last one. A worker thread splits the pieces it
 * is handed with this, and so does the main thread when it runs a pass
 * without workers.
 */

const decoder = new TextDecoder('utf-8');

export function linesOf(text: Uint8Array): string[] {
  const lines = decoder.decode(text).split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].endsWith('\r')) lines[i] = lines[i].slice(0, -1);
  }
  return lines;
}
