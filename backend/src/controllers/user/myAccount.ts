/**
 * The signed-in reader's own account: GET /api/users/me.
 */

import type { CuratorScope, MyAccount } from '../../api/responses/auth.js';
import { CURATOR_SCOPES_SQL, curatorScopeOf, type CuratorScopeOfUserRow } from '../admin/curatorScopeRows.js';
import { pool } from '../../db/index.js';
import type { UsersRow } from '../../db/schema.generated.js';
import { failure, notFound } from '../../middleware/errorHandler.js';

type AccountRow = Pick<UsersRow, 'id' | 'uuid' | 'email' | 'display_name' | 'role' | 'avatar_url'>;

/**
 * The caller's profile, read from the database (the token carries no PII), with
 * the scopes a curator or an admin holds.
 */
export async function getMyAccount({ caller }: { caller: Express.User }): Promise<MyAccount> {
  let account: AccountRow | undefined;
  let curatorScopes: CuratorScope[] | undefined;
  try {
    const userResult = await pool.query<AccountRow>(
      'SELECT id, uuid, email, display_name, role, avatar_url FROM users WHERE id = $1',
      [caller.id],
    );
    account = userResult.rows[0];
    if (account && (caller.role === 'curator' || caller.role === 'admin')) {
      const scopesResult = await pool.query<CuratorScopeOfUserRow>(CURATOR_SCOPES_SQL, [[caller.id]]);
      curatorScopes = scopesResult.rows.map(curatorScopeOf);
    }
  } catch (error) {
    console.error('Error getting user:', error);
    throw failure('Failed to get user', 500);
  }
  if (!account) throw notFound('User not found');

  return {
    id: account.id,
    uuid: account.uuid,
    email: account.email,
    displayName: account.display_name,
    role: account.role,
    avatarUrl: account.avatar_url,
    curatorScopes,
  };
}
