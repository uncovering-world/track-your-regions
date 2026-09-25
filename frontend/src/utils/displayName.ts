/**
 * A person's display name as a screen should say it: trimmed, or null for a
 * missing or blank one, so that the caller's own fallback applies (#998).
 *
 * `users.display_name` is nullable free text. Registration refuses a blank
 * name; a row written before that rule, or a provider's name read into it, can
 * still hold one, and `||` or `??` alone would show it as blank text: "by "
 * with nothing after it. The reads that name a curator in SQL fall back the
 * same way, trimming every whitespace character as `trim` does.
 */
export function displayNameOf(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
}
