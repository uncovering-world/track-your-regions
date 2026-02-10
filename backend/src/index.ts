import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env BEFORE any other imports that might use env vars
config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '../.env') });

// Log DB connection info only in development
if (process.env.NODE_ENV !== 'production') {
  console.log('DB Config:', {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
  });
}

// Now import everything else
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const app = express();
const PORT = parseInt(process.env.BACKEND_PORT || '3001');

// Security middleware
app.use(helmet({
  hsts: {
    maxAge: 31536000, // 1 year in seconds (ASVS V3.4.1)
    includeSubDomains: true,
    preload: true,
  },
}));
const FRONTEND_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true,
}));

// CSRF protection: verify Origin header on state-changing requests (ASVS V3.5.1)
// This supplements SameSite=Strict cookies and CORS preflight
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('Origin');
  // Allow requests with no Origin (e.g., same-origin, server-to-server, mobile apps)
  // Browsers always send Origin on cross-origin POST/PUT/DELETE
  if (!origin) return next();
  if (origin === FRONTEND_ORIGIN) return next();
  res.status(403).json({ error: 'Cross-origin request blocked' });
});

// Body & cookie parsing
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true })); // Needed for Apple OAuth callback

// Serve cached experience images with long cache headers
const imagesDir = join(process.cwd(), 'data', 'images');
if (!existsSync(imagesDir)) {
  mkdirSync(imagesDir, { recursive: true });
}
app.use('/images', express.static(imagesDir, {
  maxAge: '30d', // Cache for 30 days
  immutable: true,
}));

// Initialize Passport (no sessions - we use JWT)
app.use(passport.initialize());

// Lazy load routes to ensure env vars are loaded first
const startServer = async () => {
  // Initialize passport strategies
  const { initializePassport } = await import('./auth/passport.js');
  initializePassport();

  // Mark any orphaned 'running' sync logs as failed (e.g., from a previous server crash)
  const { pool } = await import('./db/index.js');
  const staleResult = await pool.query(
    `UPDATE experience_sync_logs
     SET status = 'failed', completed_at = NOW(),
         error_details = jsonb_build_array(jsonb_build_object('externalId', 'system', 'error', 'Server restarted while sync was running'))
     WHERE status = 'running'`
  );
  if (staleResult.rowCount && staleResult.rowCount > 0) {
    console.log(`🧹 Marked ${staleResult.rowCount} stale sync log(s) as failed`);
  }

  // Schedule periodic cleanup of expired/revoked tokens (every 6 hours)
  setInterval(async () => {
    try {
      await pool.query('SELECT cleanup_refresh_tokens()');
      await pool.query('SELECT cleanup_verification_tokens()');
      // Log only in development
      if (process.env.NODE_ENV !== 'production') {
        console.log('🧹 Auth token cleanup completed');
      }
    } catch (err) {
      console.error('Auth token cleanup failed:', err);
    }
  }, 6 * 60 * 60 * 1000);

  const { default: routes } = await import('./routes/index.js');
  const { errorHandler } = await import('./middleware/errorHandler.js');

  // Routes
  app.use(routes);

  // Error handling (must be last)
  app.use(errorHandler);

  // Start server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🗺️  API: http://localhost:${PORT}/api`);
  });
};

startServer().catch(console.error);
