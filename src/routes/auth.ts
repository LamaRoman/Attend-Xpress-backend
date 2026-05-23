import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { validate } from '../middleware/validate';
import { loginSchema } from '../schemas/auth.schema';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authRateLimiter, refreshRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// Cookie options
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  domain: process.env.NODE_ENV === 'production' ? '.zentaralabs.com' : undefined,
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  path: '/',
};

// POST /api/auth/login
router.post('/login', authRateLimiter, validate(loginSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user, token, refreshToken } = await authService.login(req.body);

    // Web: set httpOnly cookie
    res.cookie('token', token, COOKIE_OPTIONS);

    // Mobile + Web: return tokens in response body
    res.json({ data: { user, accessToken: token, refreshToken } });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/refresh (mobile only) — rate-limited same as login
router.post('/refresh', refreshRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ error: { message: 'Refresh token required' } }); return;
    }
    const result = await authService.refreshAccessToken(refreshToken);
    res.json({ data: { accessToken: result.accessToken, refreshToken: result.refreshToken } });
  } catch {
    res.status(401).json({ error: { message: 'Invalid or expired refresh token' } });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      await authService.logout(token);
    }
    res.clearCookie('token', {
      path: '/',
      domain: process.env.NODE_ENV === 'production' ? '.zentaralabs.com' : undefined,
    });
    res.json({ data: { message: 'Logged out successfully' } });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await authService.getMe(req.user!.userId, req.user!.membershipId);
    res.json({ data: { user } });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/auth/attendance-pin - self-service PIN change
router.patch('/attendance-pin', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPin, newPin } = req.body;
    if (!currentPin || !/^\d{4}$/.test(currentPin)) {
      res.status(400).json({ error: { message: 'Current PIN must be 4 digits', code: 'VALIDATION_ERROR' } }); return;
    }
    if (!newPin || !/^\d{4}$/.test(newPin)) {
      res.status(400).json({ error: { message: 'New PIN must be 4 digits', code: 'VALIDATION_ERROR' } }); return;
    }
    if (currentPin === newPin) {
      res.status(400).json({ error: { message: 'New PIN must be different from current PIN', code: 'VALIDATION_ERROR' } }); return;
    }
    if (!req.user!.membershipId) {
      res.status(400).json({ error: { message: 'No active organization membership', code: 'NO_MEMBERSHIP' } }); return;
    }
    const result = await authService.changeAttendancePin(req.user!.membershipId, currentPin, newPin);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: { message: 'Email is required', code: 'VALIDATION_ERROR' } });
      return;
    }
    const result = await authService.forgotPassword(email);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      res.status(400).json({ error: { message: 'Token and new password are required', code: 'VALIDATION_ERROR' } });
      return;
    }
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[!@#$%^&*(),.?":{}|<>]/.test(newPassword)) {
      res.status(400).json({ error: { message: 'Password must be at least 8 characters with 1 uppercase, 1 lowercase, 1 number, and 1 special character', code: 'VALIDATION_ERROR' } });
      return;
    }
    const result = await authService.resetPassword(token, newPassword);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/auth/change-initial-password — authenticated, for mustChangePassword flow
router.post('/change-initial-password', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword) {
      res.status(400).json({ error: { message: 'New password is required', code: 'VALIDATION_ERROR' } });
      return;
    }
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[!@#$%^&*(),.?":{}|<>]/.test(newPassword)) {
      res.status(400).json({ error: { message: 'Password must be at least 8 characters with 1 uppercase, 1 lowercase, 1 number, and 1 special character', code: 'VALIDATION_ERROR' } });
      return;
    }
    const result = await authService.changeInitialPassword(req.user!.userId, newPassword);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/auth/forgot-attendance-pin — authenticated, emails new PIN
router.post('/forgot-attendance-pin', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user!.membershipId) {
      res.status(400).json({ error: { message: 'No active organization membership', code: 'NO_MEMBERSHIP' } }); return;
    }
    const result = await authService.forgotAttendancePin(req.user!.userId, req.user!.membershipId);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/auth/change-password — authenticated, requires current password
router.post('/change-password', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword) {
      res.status(400).json({ error: { message: 'Current password is required', code: 'VALIDATION_ERROR' } }); return;
    }
    if (!newPassword) {
      res.status(400).json({ error: { message: 'New password is required', code: 'VALIDATION_ERROR' } }); return;
    }
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[!@#$%^&*(),.?":{}|<>]/.test(newPassword)) {
      res.status(400).json({ error: { message: 'Password must be at least 8 characters with 1 uppercase, 1 lowercase, 1 number, and 1 special character', code: 'VALIDATION_ERROR' } }); return;
    }
    const result = await authService.changePassword(req.user!.userId, currentPassword, newPassword);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;