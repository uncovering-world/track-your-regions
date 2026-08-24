/**
 * The bounds a password is held to, kept in one place because both forms that
 * set one — register and change-password — would otherwise carry their own copy.
 *
 * They mirror the server's schemas (`registerSchema`, `changePasswordSchema` in
 * backend `types/auth.ts`), and the mirror is not decoration: a value the form
 * lets through reaches Zod, whose rejection the error handler renders as the
 * bare string "Validation error" — the one case where deferring to the server's
 * own words yields words naming nothing a person can act on.
 *
 * No composition rules by design (ASVS V6.2.5): length is the whole of it.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/** Refusal in the schema's own words, so the two sides read alike. */
export const PASSWORD_TOO_SHORT = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
export const PASSWORD_TOO_LONG = `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
