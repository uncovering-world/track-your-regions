import { createUser, findUserByEmail, hashPassword } from '../services/authService.js';

export interface CreateAdminOpts {
  email: string;
  displayName: string;
  password: string;
}

export async function runCreateAdmin(
  opts: CreateAdminOpts,
): Promise<{ created: boolean; email: string }> {
  const email = opts.email.trim().toLowerCase();
  const existing = await findUserByEmail(email);
  if (existing) {
    // Only treat as idempotent when the account is already a usable admin.
    // Otherwise setup would "succeed" without producing an admin login.
    if (existing.role === 'admin' && existing.emailVerified) {
      return { created: false, email };
    }
    throw new Error(
      `User ${email} already exists but is not a verified admin. ` +
        `Promote them with "npm run db:make-admin ${email}", ` +
        `or set a different ADMIN_EMAIL.`,
    );
  }
  const passwordHash = await hashPassword(opts.password);
  await createUser({
    email,
    displayName: opts.displayName || email.split('@')[0],
    passwordHash,
    authProvider: 'local',
    emailVerified: true,
    role: 'admin',
  });
  return { created: true, email };
}

/** Read the password from stdin (so it never appears in argv / the process list). */
async function readPassword(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

/**
 * CLI entrypoint: ADMIN_EMAIL / ADMIN_DISPLAY_NAME from env,
 * password from stdin.
 */
async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    console.error('createAdmin: ADMIN_EMAIL is required');
    process.exit(2);
  }
  const password = await readPassword();
  if (!password) {
    console.error('createAdmin: password (via stdin) is required');
    process.exit(2);
  }
  const res = await runCreateAdmin({
    email,
    displayName: process.env.ADMIN_DISPLAY_NAME ?? '',
    password,
  });
  if (res.created) {
    console.log(`Admin created: ${res.email}`);
  } else {
    console.log(
      `Admin already exists: ${res.email}` +
        ` (use "npm run db:make-admin <email>" to promote an existing user)`,
    );
  }
  process.exit(0);
}

// Only run main() when invoked directly (extension-agnostic: works under tsx
// and a compiled build), not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
