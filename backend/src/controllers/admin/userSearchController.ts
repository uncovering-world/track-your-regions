/**
 * Find an account to promote to curator (ADR-0071).
 */

import type { z } from 'zod/v4';
import type { UserSearchResults } from '../../api/responses/admin.js';
import { pool } from '../../db/index.js';
import type { UsersRow } from '../../db/schema.generated.js';
import type { adminUserSearchQuerySchema } from '../../types/index.js';

/**
 * GET /api/admin/users/search?q=
 * The first twenty accounts whose display name or email contains `q`.
 */
export async function searchUsers(
  { query: { q } }: { query: z.output<typeof adminUserSearchQuerySchema> },
): Promise<UserSearchResults> {
  const result = await pool.query<Pick<UsersRow, 'id' | 'display_name' | 'email' | 'role'>>(`
    SELECT id, display_name, email, role
    FROM users
    WHERE display_name ILIKE $1 OR email ILIKE $1
    ORDER BY display_name
    LIMIT 20
  `, [`%${q}%`]);

  return result.rows.map(u => ({
    id: u.id,
    display_name: u.display_name,
    email: u.email,
    role: u.role,
  }));
}
