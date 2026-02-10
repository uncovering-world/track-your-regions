import { Router } from 'express';
import divisionRoutes from './divisionRoutes.js';
import viewRoutes from './viewRoutes.js';
import worldViewRoutes from './worldViewRoutes.js';
import userRoutes from './userRoutes.js';
import aiRoutes from './aiRoutes.js';
import authRoutes from './authRoutes.js';
import adminRoutes from './adminRoutes.js';
import experienceRoutes from './experienceRoutes.js';
import geocodeRoutes from './geocodeRoutes.js';
import { pool } from '../db/index.js';
import { initOpenAI } from '../services/ai/openaiService.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

// Initialize OpenAI on module load
initOpenAI();

const router = Router();

// Health check (public)
router.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', database: 'disconnected', timestamp: new Date().toISOString() });
  }
});

// Auth routes (public)
router.use('/api/auth', authRoutes);

// Protected API routes
router.use('/api/divisions', requireAuth, requireAdmin, divisionRoutes);  // GADM data - admin only
router.use('/api/world-views', worldViewRoutes);  // World Views - mixed auth (read: user, write: admin)
router.use('/api/views', requireAuth, requireAdmin, viewRoutes);  // Views - admin only
router.use('/api/users', userRoutes);  // User and visited regions - auth handled per route
router.use('/api/ai', requireAuth, requireAdmin, aiRoutes);  // AI-assisted features - admin only
router.use('/api/admin', requireAuth, requireAdmin, adminRoutes);  // Admin dashboard - admin only
router.use('/api/experiences', experienceRoutes);  // Experiences - public read
router.use('/api/geocode', geocodeRoutes);  // Geocode/place search - public

// Legacy routes for backward compatibility (admin only)
router.use('/api/regions', requireAuth, requireAdmin, divisionRoutes);
router.use('/api/hierarchies', worldViewRoutes);

export default router;
