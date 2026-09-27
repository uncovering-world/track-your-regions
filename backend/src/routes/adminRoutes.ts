/**
 * Admin Routes, mounted at /api/admin: every one declared in
 * `routes/adminDeclaredRoutes.ts` (ADR-0071).
 */

import { routerOf } from '../api/route.js';
import { adminDeclaredRoutes } from './adminDeclaredRoutes.js';

export default routerOf(adminDeclaredRoutes);
