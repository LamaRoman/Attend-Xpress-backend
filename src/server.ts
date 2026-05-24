import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import crypto from 'crypto';
import { config, corsOrigins } from './config';
import { authService } from './services/auth.service';
import { logger } from './logger';
import { generalRateLimiter } from './middleware/rateLimiter';
import { sanitizeInput } from './middleware/sanitize';
import { errorHandler } from './middleware/errorHandler';
import prisma from './lib/prisma';
import { redisClient } from './lib/redis';
import notificationRoutes from './routes/notifications';
import { notificationService } from './services/notification.service';
import { startTrialExpiryJob } from './jobs/trial-expiry.job';
import { startBillingJob } from './jobs/billing.job';
import { startPriceExpiryJob } from './jobs/price-expiry.job';
import { startGracePeriodJob } from './jobs/grace-period.job';
import { startAbandonedJob } from './jobs/abandoned.job';
import { startMidnightAutoCloseJob } from './jobs/midnight-autoclose.job';
import { setupSwagger } from './swagger';

// Route imports
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import qrRoutes from './routes/qr';
import attendanceRoutes from './routes/attendance';
import reportsRoutes from './routes/reports';
import payrollRoutes, { employeePayrollRouter } from './routes/payroll';
import holidayRoutes from './routes/holidays';
import masterHolidayRoutes from './routes/masterHolidays';
import configRoutes from './routes/config';
import nepaliDateRoutes from './routes/nepali-date';
import superAdminRoutes from './routes/superAdmin';
import leaveRoutes from './routes/leaves';
import orgSettingsRoutes from './routes/orgSettings';
import superAdminSubscriptionRouter from './routes/superadmin.subscription.routes';
import platformConfigRouter from './routes/superadmin.platform-config.routes';
import superAdminPlansRouter from './routes/superadmin.plans.routes';
import documentTypeRoutes from './routes/documentTypes';
import documentRoutes from './routes/documents';
import leaveBalanceRoutes from './routes/leaveBalance';
import rosterRoutes from './routes/roster';
import fieldTrackingRoutes from './routes/field-tracking';
import branchesRoutes from './routes/branches';
import superAdminBranchesRouter from './routes/superadmin.branches.routes';

const app = express();
app.set('trust proxy', 1);

// Redirect HTTP to HTTPS in production
if (config.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.hostname}${req.url}`);
    }
    next();
  });
}

// ============================================================
// Security Middleware
// ============================================================
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: [
          "'self'",
          ...(config.NODE_ENV === 'production'
            ? []
            : ['http://localhost:3000', 'http://localhost:5001']),
        ],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    noSniff: true,
    xssFilter: true,
  })
);
app.use(generalRateLimiter);

// ============================================================
// Request ID -- unique per request for log correlation
// ============================================================
app.use((req, res, next) => {
  const rawId = req.headers['x-request-id'] as string | undefined;
  const isValidId = rawId && /^[a-zA-Z0-9-]{1,36}$/.test(rawId);
  const requestId = isValidId ? rawId : crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  (req as any).requestId = requestId;
  next();
});

// ============================================================
// CSRF Protection -- Custom Header Check
//
// Exemptions:
//   - GET/HEAD/OPTIONS (safe methods)
//   - /api/v1/attendance/scan-public  (unauthenticated QR scan)
//   - /api/v1/attendance/mobile-checkin (unauthenticated GPS check-in)
// ============================================================
const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT_PATHS = new Set([
  '/api/v1/attendance/scan-public',
  '/api/v1/attendance/mobile-checkin',
]);

app.use((req, res, next) => {
  if (CSRF_SAFE_METHODS.has(req.method)) return next();
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();

  const hasCustomHeader = req.headers['x-requested-with'] === 'XMLHttpRequest';
  if (!hasCustomHeader) {
    logger.warn(
      {
        method: req.method,
        path: req.path,
        ip: req.ip,
      },
      'CSRF check failed -- missing X-Requested-With header'
    );
    return res.status(403).json({
      error: { message: 'CSRF check failed', code: 'CSRF_REJECTED' },
    });
  }
  next();
});

// ============================================================
// Core Middleware
// ============================================================
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(sanitizeInput);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(
      {
        requestId: (req as any).requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${Date.now() - start}ms`,
        ip: req.ip,
      },
      `${req.method} ${req.path} ${res.statusCode}`
    );
  });
  next();
});

// ============================================================
// API v1 Router — all routes consolidated
// ============================================================
const v1Router = express.Router();

v1Router.use('/auth', authRoutes);
v1Router.use('/', documentTypeRoutes);
v1Router.use('/', documentRoutes);
v1Router.use('/users', userRoutes);
v1Router.use('/qr', qrRoutes);
v1Router.use('/attendance', attendanceRoutes);
v1Router.use('/reports', reportsRoutes);
v1Router.use('/payroll', employeePayrollRouter);
v1Router.use('/payroll', payrollRoutes);
v1Router.use('/holidays', holidayRoutes);
v1Router.use('/master-holidays', masterHolidayRoutes);
v1Router.use('/config', configRoutes);
v1Router.use('/nepali-date', nepaliDateRoutes);
v1Router.use('/org-settings', orgSettingsRoutes);
v1Router.use('/leaves', leaveRoutes);
v1Router.use('/leave-balance', leaveBalanceRoutes);
v1Router.use('/roster', rosterRoutes);
v1Router.use('/field-tracking', fieldTrackingRoutes);
v1Router.use('/branches', branchesRoutes);
v1Router.use('/super-admin', superAdminRoutes);
v1Router.use('/notifications', notificationRoutes);
v1Router.use('/super-admin/subscriptions', superAdminSubscriptionRouter);
v1Router.use('/super-admin/platform-config', platformConfigRouter);
v1Router.use('/super-admin/plans', superAdminPlansRouter);
v1Router.use('/super-admin/branches', superAdminBranchesRouter);

v1Router.get('/health', async (req, res) => {
  let dbStatus: 'connected' | 'disconnected' = 'disconnected';
  let redisStatus: 'connected' | 'disconnected' | 'not_configured' = 'not_configured';

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch {
    /* fall through */
  }

  if (redisClient) {
    try {
      await redisClient.ping();
      redisStatus = 'connected';
    } catch {
      redisStatus = 'disconnected';
    }
  }

  // DB is fatal. Redis is fatal only if it was configured (a degraded
  // Redis means lockouts silently fall back to per-instance memory state,
  // which breaks horizontal scaling — surface that to the load balancer).
  const healthy = dbStatus === 'connected' && redisStatus !== 'disconnected';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    version: 'v1',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    database: dbStatus,
    redis: redisStatus,
  });
});

// Version header middleware
const versionHeader = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.setHeader('X-API-Version', 'v1');
  next();
};

// Versioned API mount
app.use('/api/v1', versionHeader, v1Router);

// Swagger UI — available at /api-docs
setupSwagger(app);

// ============================================================
// Error Handler (must be last)
// ============================================================
app.use(errorHandler);

// ============================================================
// Start Server + Graceful Shutdown
// ============================================================
const PORT = parseInt(config.PORT, 10);

const server = app.listen(PORT, () => {
  logger.info(`Backend server running on http://localhost:${PORT}`);
  logger.info(`Environment: ${config.NODE_ENV}`);
  logger.info(`CORS origins: ${corsOrigins.join(', ')}`);

  // Cleanup expired sessions every hour
  setInterval(
    async () => {
      try {
        await authService.cleanExpiredSessions();
      } catch (e) {
        /* ignore */
      }
    },
    60 * 60 * 1000
  );

  // Cleanup old notifications daily
  setInterval(
    async () => {
      try {
        await notificationService.deleteOldNotifications();
      } catch (e) {
        /* ignore */
      }
    },
    24 * 60 * 60 * 1000
  );

  // Scheduled jobs
  startTrialExpiryJob();
  startBillingJob();
  startPriceExpiryJob();
  startGracePeriodJob();
  startAbandonedJob();
  startMidnightAutoCloseJob();
});

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`${signal} received. Shutting down gracefully...`);

  server.close(async () => {
    logger.info('HTTP server closed');
    await prisma.$disconnect();
    logger.info('Database disconnected');
    process.exit(0);
  });

  // Force kill after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;