/**
 * The sentences the OAuth strategies refuse a sign-in with, written for the
 * person signing in, and the only text a callback puts in the address it
 * redirects to (#1021).
 *
 * `info.message` is not only ours: passport-oauth2 fills it from a provider's
 * `error_description`, which arrives on the callback's query string and so is
 * text whoever sends the request controls. A callback that redirected with it
 * would show that text on our page, under our name.
 */
export const OAUTH_REFUSALS = {
  emailTaken: 'An account with this email already exists. Please log in with your password.',
  emailRequired: 'Email is required for registration',
} as const;

const KNOWN_REFUSALS = new Set<string>(Object.values(OAUTH_REFUSALS));

/** What a failed callback tells the person signing in: one of our refusals, or a fixed sentence. */
export function oauthRefusal(info: { message?: string } | undefined): string {
  return info?.message && KNOWN_REFUSALS.has(info.message) ? info.message : 'Authentication failed';
}
