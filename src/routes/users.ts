import { Router, Response, NextFunction } from 'express';
import { userService } from '../services/user.service';
import { validate } from '../middleware/validate';
import { createUserSchema, updateUserSchema, userIdParamSchema, addExistingUserSchema } from '../schemas/user.schema';
import { authenticate, requireOrgAdmin, enforceOrgIsolation, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { verifyPassword } from '../lib/password';
import { emailService } from '../services/email.service';

const router = Router();

router.use(authenticate);

// GET /api/users
router.get('/', requireOrgAdmin, enforceOrgIsolation, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const isFieldStaff =
      req.query.isFieldStaff === 'true'
        ? true
        : req.query.isFieldStaff === 'false'
        ? false
        : undefined;
    const users = await userService.listUsers(req.user!, { isFieldStaff });
    res.json({ data: users });
  } catch (error) {
    next(error);
  }
});

// GET /api/users/upcoming-birthdays?days=30
router.get('/upcoming-birthdays', requireOrgAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.json([]);

    const days = Math.min(parseInt(req.query.days as string) || 30, 90);

    const memberships = await prisma.orgMembership.findMany({
      where: {
        organizationId,
        isActive: true,
        leftAt: null,
        deletedAt: null,
        user: { dateOfBirth: { not: null } },
      },
      select: {
        employeeId: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
          },
        },
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = memberships
      .map((m) => {
        const dob = m.user.dateOfBirth!;
        // Next birthday this year or next
        let next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
        if (next < today) next.setFullYear(today.getFullYear() + 1);
        const daysUntil = Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return {
          id: m.user.id,
          firstName: m.user.firstName,
          lastName: m.user.lastName,
          employeeId: m.employeeId,
          dateOfBirth: m.user.dateOfBirth,
          daysUntil,
          isToday: daysUntil === 0,
        };
      })
      .filter((e) => e.daysUntil <= days)
      .sort((a, b) => a.daysUntil - b.daysUntil);

    res.json(upcoming);
  } catch (error) {
    next(error);
  }
});

// POST /api/users — Create brand new user + membership
router.post('/', requireOrgAdmin, enforceOrgIsolation, validate(createUserSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await userService.createUser(req.body, req.user!);
    res.status(201).json({ data: user });
  } catch (error) {
    next(error);
  }
});

// POST /api/users/add-existing — Add existing platform user by Platform ID
router.post('/add-existing', requireOrgAdmin, enforceOrgIsolation, validate(addExistingUserSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await userService.addExistingUserByPlatformId(req.body, req.user!);
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PUT /api/users/:id
router.put('/:id', enforceOrgIsolation, validate(userIdParamSchema, 'params'), validate(updateUserSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const isSelf = req.params.id === req.user!.userId;
    const isAdmin = req.user!.role === 'ORG_ADMIN' || req.user!.role === 'SUPER_ADMIN';

    if (!isSelf && !isAdmin) {
      return res.status(403).json({ error: { message: 'You can only update your own profile' } });
    }

    // Non-admins cannot change org-scoped fields
    if (!isAdmin) {
      delete req.body.role;
      delete req.body.isActive;
      delete req.body.isFieldStaff;
      delete req.body.shiftStartTime;
      delete req.body.shiftEndTime;
      delete req.body.panNumber;
    }

    // ── Email-change verification ────────────────────────────────────────
    // An email change is an account-takeover vector. For self-updates, an
    // attacker with a session can change the email to their own and trigger
    // a password reset. For admin-initiated updates, an attacker with an
    // admin session can silently change any employee's email and take over
    // that account.
    //
    // Both paths require password reconfirmation. Self-updates verify the
    // user's own password; admin-updates verify the admin's own password.
    // On either path, if the email actually changes we notify the TARGET
    // at their OLD address, giving them a signal to investigate.
    let oldEmail: string | null = null;
    let oldFirstName: string | null = null;

    if (isSelf && req.body.email) {
      const currentUser = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { email: true, password: true, firstName: true },
      });
      if (!currentUser) {
        return res.status(404).json({ error: { message: 'User not found' } });
      }

      // If the email is actually changing, require currentPassword.
      if (req.body.email !== currentUser.email) {
        const currentPassword = req.body.currentPassword;
        if (!currentPassword) {
          return res.status(400).json({
            error: {
              message: 'Current password is required to change your email address.',
              code: 'CURRENT_PASSWORD_REQUIRED',
            },
          });
        }

        const valid = await verifyPassword(currentPassword, currentUser.password);
        if (!valid) {
          return res.status(401).json({
            error: {
              message: 'Current password is incorrect.',
              code: 'INVALID_PASSWORD',
            },
          });
        }

        oldEmail = currentUser.email;
        oldFirstName = currentUser.firstName;
      }
    } else if (!isSelf && isAdmin && req.body.email) {
      // Admin changing another user's email.
      const targetUser = await prisma.user.findUnique({
        where: { id: String(req.params.id) },
        select: { email: true, firstName: true },
      });
      if (!targetUser) {
        return res.status(404).json({ error: { message: 'User not found' } });
      }

      // If the email is actually changing, require the ADMIN's currentPassword.
      if (req.body.email !== targetUser.email) {
        const currentPassword = req.body.currentPassword;
        if (!currentPassword) {
          return res.status(400).json({
            error: {
              message: 'Your current password is required to change another user\'s email address.',
              code: 'CURRENT_PASSWORD_REQUIRED',
            },
          });
        }

        const adminUser = await prisma.user.findUnique({
          where: { id: req.user!.userId },
          select: { password: true },
        });
        if (!adminUser) {
          return res.status(404).json({ error: { message: 'User not found' } });
        }

        const valid = await verifyPassword(currentPassword, adminUser.password);
        if (!valid) {
          return res.status(401).json({
            error: {
              message: 'Current password is incorrect.',
              code: 'INVALID_PASSWORD',
            },
          });
        }

        oldEmail = targetUser.email;
        oldFirstName = targetUser.firstName;
      }
    }

    // Strip currentPassword before forwarding — it's a validation field, not a stored field.
    delete req.body.currentPassword;

    const user = await userService.updateUser(String(req.params.id), req.body, req.user!);

    // If we successfully changed a self-email, notify the OLD address.
    // Fire-and-forget — don't block the response on email delivery.
    if (oldEmail && oldFirstName && req.body.email) {
      emailService
        .sendEmailChangedNotification({
          to: oldEmail,
          firstName: oldFirstName,
          newEmail: req.body.email,
          changedAt: new Date(),
        })
        .catch((err) =>
          console.error('[users] Failed to send email-changed notification', err)
        );
    }

    res.json({ data: user });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/users/:id — removes employee from organization (membership deactivated, user intact)
router.delete('/:id', requireOrgAdmin, enforceOrgIsolation, validate(userIdParamSchema, 'params'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await userService.removeFromOrganization(String(req.params.id), req.user!);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/users/:id/attendance-pin — admin resets an employee's PIN
router.patch('/:id/attendance-pin', requireOrgAdmin, enforceOrgIsolation, validate(userIdParamSchema, 'params'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await userService.resetAttendancePin(String(req.params.id), req.user!);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/users/:id/status
router.patch('/:id/status', requireOrgAdmin, enforceOrgIsolation, validate(userIdParamSchema, 'params'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await userService.updateUser(String(req.params.id), { isActive: req.body.isActive }, req.user!);
    res.json({ data: user });
  } catch (error) {
    next(error);
  }
});

export default router;