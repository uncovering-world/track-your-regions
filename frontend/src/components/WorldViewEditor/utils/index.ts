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

  // Trim trailing spaces and special characters
  return prefix.replace(/[\s\-_,.:;]+$/, '').trim();
}
