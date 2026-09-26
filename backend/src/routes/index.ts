import { Router } from 'express';
import divisionRoutes from './divisionRoutes.js';
import worldViewRoutes from './worldViewRoutes.js';
import userRoutes from './userRoutes.js';
import aiRoutes from './aiRoutes.js';
import authRoutes from './authRoutes.js';
import adminRoutes from './adminRoutes.js';
import experienceRoutes from './experienceRoutes.js';
import geocodeRoutes from './geocodeRoutes.js';
import healthRoutes from './healthRoutes.js';
import { initOpenAI } from '../services/ai/openaiService.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

// Initialize OpenAI on module load
initOpenAI();

const router = Router();

// Health check (public)
router.use(healthRoutes);

// Auth routes (public)
router.use('/api/auth', authRoutes);

// Protected API routes
router.use('/api/divisions', divisionRoutes);  // GADM data - admin only, declared per route (ADR-0071)
router.use('/api/world-views', worldViewRoutes);  // World Views - mixed auth (read: user, write: admin)
router.use('/api/users', userRoutes);  // User and visited regions - auth handled per route
router.use('/api/ai', aiRoutes);  // AI-assisted features - admin only, declared per route (ADR-0071)
router.use('/api/admin', requireAuth, requireAdmin, adminRoutes);  // Admin dashboard - admin only
router.use('/api/experiences', experienceRoutes);  // Experiences - public read
router.use('/api/geocode', geocodeRoutes);  // Geocode/place search - public

export default router;
