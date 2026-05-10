// Helper function to find common prefix in an array of strings
export function findCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  if (strings.length === 1) return strings[0];

  // Find the shortest string
  const minLen = Math.min(...strings.map(s => s.length));

  let prefix = '';
  for (let i = 0; i < minLen; i++) {
    const char = strings[0][i];
    if (strings.every(s => s[i] === char)) {
      prefix += char;
    } else {
      break;
    }
  }

  // Trim trailing spaces and special characters.
  // eslint-disable-next-line sonarjs/slow-regex -- bounded character class anchored to end-of-string; input is a common prefix derived from a small list of region names
  return prefix.replace(/[\s\-_,.:;]+$/, '').trim();
}
