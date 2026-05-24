import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Attend-Xpress API',
    version: '1.0.0',
    description:
      'Smart attendance management system API for Nepal. Covers employee check-in/out (QR, GPS, mobile), leave management, payroll, reports, and multi-org administration.',
    contact: { name: 'Zentara Labs' },
  },
  servers: [
    { url: '/api/v1', description: 'Current API version' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT access token. Mobile apps pass this via Authorization header.',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'token',
        description: 'JWT set as httpOnly cookie by the login endpoint (web clients).',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              code: { type: 'string' },
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          role: { type: 'string', enum: ['SUPER_ADMIN', 'ORG_ADMIN', 'BRANCH_ADMIN', 'ORG_ACCOUNTANT', 'EMPLOYEE'] },
          isActive: { type: 'boolean' },
          phone: { type: 'string', nullable: true },
          platformId: { type: 'string', nullable: true },
          dateOfBirth: { type: 'string', format: 'date', nullable: true },
          mustChangePassword: { type: 'boolean' },
        },
      },
      AttendanceRecord: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          membershipId: { type: 'string' },
          organizationId: { type: 'string' },
          checkInTime: { type: 'string', format: 'date-time' },
          checkOutTime: { type: 'string', format: 'date-time', nullable: true },
          duration: { type: 'integer', nullable: true, description: 'Duration in minutes' },
          status: { type: 'string', enum: ['CHECKED_IN', 'CHECKED_OUT', 'AUTO_CLOSED', 'MANUALLY_CLOSED'] },
          checkInMethod: { type: 'string', enum: ['QR_SCAN', 'MOBILE_CHECKIN', 'MANUAL'] },
          isManualEntry: { type: 'boolean' },
          bsYear: { type: 'integer' },
          bsMonth: { type: 'integer' },
          bsDay: { type: 'integer' },
        },
      },
      Leave: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          membershipId: { type: 'string' },
          organizationId: { type: 'string' },
          startDate: { type: 'string', format: 'date-time' },
          endDate: { type: 'string', format: 'date-time' },
          type: { type: 'string', enum: ['ANNUAL', 'SICK', 'CASUAL', 'MATERNITY', 'PATERNITY', 'UNPAID'] },
          status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
          reason: { type: 'string' },
          rejectionMessage: { type: 'string', nullable: true },
        },
      },
      PayrollRecord: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          membershipId: { type: 'string' },
          bsYear: { type: 'integer' },
          bsMonth: { type: 'integer' },
          basicSalary: { type: 'number' },
          grossSalary: { type: 'number' },
          netSalary: { type: 'number' },
          totalDeductions: { type: 'number' },
          status: { type: 'string', enum: ['DRAFT', 'APPROVED', 'PAID'] },
        },
      },
      Organization: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          slug: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string', nullable: true },
          address: { type: 'string', nullable: true },
          isActive: { type: 'boolean' },
          attendanceMode: { type: 'string', enum: ['QR_ONLY', 'GPS_ONLY', 'BOTH'] },
          workStartTime: { type: 'string', example: '10:00' },
          workEndTime: { type: 'string', example: '18:00' },
          geofenceEnabled: { type: 'boolean' },
        },
      },
      Notification: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          organizationId: { type: 'string' },
          type: { type: 'string' },
          title: { type: 'string' },
          message: { type: 'string' },
          isRead: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  tags: [
    { name: 'Health', description: 'System health check' },
    { name: 'Auth', description: 'Authentication and password management' },
    { name: 'Users', description: 'Employee and user management within an organization' },
    { name: 'Attendance', description: 'Clock-in/out via QR, GPS, and mobile. Public and authenticated endpoints.' },
    { name: 'QR Code', description: 'Manage rotating and static QR codes for attendance scanning' },
    { name: 'Leaves', description: 'Leave requests — submit, approve, reject' },
    { name: 'Leave Balance', description: 'Leave balance tracking per BS year' },
    { name: 'Payroll', description: 'Payroll generation, records, payslips, and exports' },
    { name: 'Reports', description: 'Daily, weekly, monthly attendance reports and duty roster PDF' },
    { name: 'Holidays', description: 'Organization holiday management' },
    { name: 'Master Holidays', description: 'Super-admin managed national holidays library' },
    { name: 'Org Settings', description: 'Organization configuration and subscription info' },
    { name: 'Config', description: 'Per-org system config keys (scan cooldown, working hours, etc.)' },
    { name: 'Notifications', description: 'In-app notification management' },
    { name: 'Documents', description: 'Employee document uploads and downloads' },
    { name: 'Document Types', description: 'Manage document type catalogue for an organization' },
    { name: 'Roster', description: 'Employee shift schedule (roster) management' },
    { name: 'Field Tracking', description: 'GPS location logs for field staff' },
    { name: 'Branches', description: 'Branch management and geofencing' },
    { name: 'Nepali Date', description: 'BS ↔ AD date conversion utilities' },
    { name: 'Super Admin – Orgs', description: 'Platform-wide organization management (SUPER_ADMIN only)' },
    { name: 'Super Admin – Subscriptions', description: 'Subscription lifecycle management (SUPER_ADMIN only)' },
    { name: 'Super Admin – Plans', description: 'Pricing plan feature flags and pricing (SUPER_ADMIN only)' },
    { name: 'Super Admin – Platform Config', description: 'Global platform configuration keys (SUPER_ADMIN only)' },
    { name: 'Super Admin – Branches', description: 'Super-admin branch operations' },
  ],
  paths: {
    // ────────────────────────────────────────────────
    // HEALTH
    // ────────────────────────────────────────────────
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        security: [],
        responses: {
          200: {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    version: { type: 'string', example: 'v1' },
                    timestamp: { type: 'string', format: 'date-time' },
                    uptime: { type: 'integer' },
                    database: { type: 'string', enum: ['connected', 'disconnected'] },
                    redis: { type: 'string', enum: ['connected', 'disconnected', 'not_configured'] },
                  },
                },
              },
            },
          },
          503: { description: 'Service degraded' },
        },
      },
    },

    // ────────────────────────────────────────────────
    // AUTH
    // ────────────────────────────────────────────────
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login',
        security: [],
        description:
          'Authenticate with email and password. Returns an access token (in body for mobile) and sets an httpOnly cookie (for web). All non-GET requests must include `X-Requested-With: XMLHttpRequest` header.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'orgadmin@democompany.com' },
                  password: { type: 'string', example: 'OrgAdmin@1234' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        user: { $ref: '#/components/schemas/User' },
                        accessToken: { type: 'string' },
                        refreshToken: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Refresh access token',
        security: [],
        description: 'Exchange a refresh token for a new access token and refresh token pair (mobile use).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: { refreshToken: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'New token pair',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        accessToken: { type: 'string' },
                        refreshToken: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: 'Invalid or expired refresh token' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout',
        description: 'Invalidates the current session token and clears the cookie.',
        responses: {
          200: { description: 'Logged out successfully' },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get current user',
        description: 'Returns the authenticated user profile and active membership details.',
        responses: {
          200: {
            description: 'Current user',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { data: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } },
                },
              },
            },
          },
          401: { description: 'Not authenticated' },
        },
      },
    },
    '/auth/attendance-pin': {
      patch: {
        tags: ['Auth'],
        summary: 'Change own attendance PIN',
        description: 'Employee self-service PIN change. Both current and new PINs must be 4 digits.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPin', 'newPin'],
                properties: {
                  currentPin: { type: 'string', pattern: '^[0-9]{4}$', example: '1234' },
                  newPin: { type: 'string', pattern: '^[0-9]{4}$', example: '5678' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'PIN updated' },
          400: { description: 'Validation error' },
        },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Request password reset email',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: { email: { type: 'string', format: 'email' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Reset email sent if account exists' } },
      },
    },
    '/auth/reset-password': {
      post: {
        tags: ['Auth'],
        summary: 'Reset password with token',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'newPassword'],
                properties: {
                  token: { type: 'string' },
                  newPassword: { type: 'string', description: 'Min 8 chars, 1 upper, 1 lower, 1 digit, 1 special' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Password reset successful' }, 400: { description: 'Invalid token or weak password' } },
      },
    },
    '/auth/change-initial-password': {
      post: {
        tags: ['Auth'],
        summary: 'Change password on first login (mustChangePassword flow)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['newPassword'],
                properties: { newPassword: { type: 'string' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Password changed' } },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Change own password (authenticated)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'newPassword'],
                properties: {
                  currentPassword: { type: 'string' },
                  newPassword: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Password changed' }, 401: { description: 'Current password incorrect' } },
      },
    },
    '/auth/forgot-attendance-pin': {
      post: {
        tags: ['Auth'],
        summary: 'Email a new attendance PIN to self',
        description: 'Generates and emails a new random PIN to the authenticated employee.',
        responses: { 200: { description: 'New PIN emailed' } },
      },
    },

    // ────────────────────────────────────────────────
    // USERS
    // ────────────────────────────────────────────────
    '/users': {
      get: {
        tags: ['Users'],
        summary: 'List employees in the organization',
        parameters: [
          {
            in: 'query',
            name: 'isFieldStaff',
            schema: { type: 'boolean' },
            description: 'Filter by field staff status',
          },
        ],
        responses: {
          200: {
            description: 'List of users with membership details',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } } },
          },
        },
      },
      post: {
        tags: ['Users'],
        summary: 'Create a new employee',
        description: 'Creates a platform user account and links them to the organization. An invitation email is sent.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'firstName', 'lastName'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                  phone: { type: 'string' },
                  role: { type: 'string', enum: ['ORG_ADMIN', 'BRANCH_ADMIN', 'ORG_ACCOUNTANT', 'EMPLOYEE'], default: 'EMPLOYEE' },
                  employeeId: { type: 'string' },
                  shiftStartTime: { type: 'string', example: '10:00' },
                  shiftEndTime: { type: 'string', example: '18:00' },
                  isFieldStaff: { type: 'boolean' },
                  branchId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Employee created' },
          409: { description: 'Email already in use' },
        },
      },
    },
    '/users/upcoming-birthdays': {
      get: {
        tags: ['Users'],
        summary: 'Upcoming employee birthdays',
        parameters: [
          { in: 'query', name: 'days', schema: { type: 'integer', default: 30, maximum: 90 }, description: 'Days to look ahead' },
        ],
        responses: { 200: { description: 'Sorted list of upcoming birthdays' } },
      },
    },
    '/users/add-existing': {
      post: {
        tags: ['Users'],
        summary: 'Add an existing platform user to this organization',
        description: 'Links an existing user (by their platformId) to the organization without creating a new account.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['platformId'],
                properties: {
                  platformId: { type: 'string', description: "The user's platform-wide ID" },
                  role: { type: 'string', enum: ['EMPLOYEE', 'BRANCH_ADMIN'] },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'User added' }, 404: { description: 'Platform user not found' } },
      },
    },
    '/users/{id}': {
      put: {
        tags: ['Users'],
        summary: 'Update user profile',
        description: 'Employees can update their own profile; admins can update any user. Email changes require password re-confirmation.',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                  phone: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  currentPassword: { type: 'string', description: 'Required when changing email' },
                  dateOfBirth: { type: 'string', format: 'date' },
                  role: { type: 'string', description: 'Admin only' },
                  isActive: { type: 'boolean', description: 'Admin only' },
                  shiftStartTime: { type: 'string', description: 'Admin only' },
                  shiftEndTime: { type: 'string', description: 'Admin only' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated user' }, 403: { description: 'Cannot update other users' } },
      },
      delete: {
        tags: ['Users'],
        summary: 'Remove employee from organization',
        description: "Deactivates the membership. The user's platform account is preserved.",
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Membership deactivated' } },
      },
    },
    '/users/{id}/attendance-pin': {
      patch: {
        tags: ['Users'],
        summary: "Admin: reset an employee's attendance PIN",
        description: 'Generates a new random PIN and emails it to the employee.',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'PIN reset and emailed' } },
      },
    },
    '/users/{id}/status': {
      patch: {
        tags: ['Users'],
        summary: 'Toggle employee active status',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['isActive'], properties: { isActive: { type: 'boolean' } } },
            },
          },
        },
        responses: { 200: { description: 'Status updated' } },
      },
    },

    // ────────────────────────────────────────────────
    // ATTENDANCE
    // ────────────────────────────────────────────────
    '/attendance/qr-org-info/{token}': {
      get: {
        tags: ['Attendance'],
        summary: 'Get org geofence info for a QR token (public)',
        security: [],
        description: 'Returns whether the org has geofencing enabled. Used by the scan page to skip location prompt.',
        parameters: [{ in: 'path', name: 'token', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Geofence config',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { data: { type: 'object', properties: { geofenceEnabled: { type: 'boolean' } } } } },
              },
            },
          },
          404: { description: 'QR code not found' },
        },
      },
    },
    '/attendance/org-mode/{orgId}': {
      get: {
        tags: ['Attendance'],
        summary: 'Get org attendance mode by ID (public)',
        security: [],
        parameters: [{ in: 'path', name: 'orgId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'attendanceMode and geofenceEnabled' }, 404: { description: 'Not found' } },
      },
    },
    '/attendance/org-slug/{slug}': {
      get: {
        tags: ['Attendance'],
        summary: 'Get org info by slug (public)',
        security: [],
        parameters: [{ in: 'path', name: 'slug', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'org id, attendanceMode, geofenceEnabled' }, 404: { description: 'Not found' } },
      },
    },
    '/attendance/scan-public': {
      post: {
        tags: ['Attendance'],
        summary: 'QR scan without authentication (kiosk)',
        security: [],
        description: 'Unauthenticated check-in via QR token + employee ID + PIN. CSRF exempt.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'employeeId', 'pin'],
                properties: {
                  token: { type: 'string', description: 'QR code token' },
                  employeeId: { type: 'string', example: 'EMP-10001' },
                  pin: { type: 'string', pattern: '^[0-9]{4}$', example: '1234' },
                  latitude: { type: 'number' },
                  longitude: { type: 'number' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Check-in/out result' }, 400: { description: 'Invalid PIN or QR' } },
      },
    },
    '/attendance/mobile-checkin': {
      post: {
        tags: ['Attendance'],
        summary: 'GPS check-in without authentication (kiosk use)',
        security: [],
        description: 'Unauthenticated GPS-based check-in using employee ID + PIN. CSRF exempt.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['employeeId', 'pin', 'organizationId'],
                properties: {
                  employeeId: { type: 'string' },
                  pin: { type: 'string', pattern: '^[0-9]{4}$' },
                  organizationId: { type: 'string' },
                  latitude: { type: 'number' },
                  longitude: { type: 'number' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Check-in/out result' } },
      },
    },
    '/attendance/mobile-checkin-auth': {
      post: {
        tags: ['Attendance'],
        summary: 'GPS check-in for authenticated mobile app',
        description: 'Employee is identified via JWT — no PIN required. Coordinates are optional; service enforces them when geofence is enabled.',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  latitude: { type: 'number' },
                  longitude: { type: 'number' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Check-in/out result' } },
      },
    },
    '/attendance/scan': {
      post: {
        tags: ['Attendance'],
        summary: 'QR scan for authenticated mobile app',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token'],
                properties: {
                  token: { type: 'string' },
                  latitude: { type: 'number' },
                  longitude: { type: 'number' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Check-in/out result' } },
      },
    },
    '/attendance/status': {
      get: {
        tags: ['Attendance'],
        summary: 'Get own current clock-in status',
        responses: { 200: { description: 'Current status (checked in / out)' } },
      },
    },
    '/attendance/my': {
      get: {
        tags: ['Attendance'],
        summary: 'Get own attendance records',
        parameters: [
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
          { in: 'query', name: 'offset', schema: { type: 'integer', default: 0 } },
          { in: 'query', name: 'bsYear', schema: { type: 'integer' } },
          { in: 'query', name: 'bsMonth', schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'Paginated attendance records' } },
      },
    },
    '/attendance/user/{userId}': {
      get: {
        tags: ['Attendance'],
        summary: 'Admin: get attendance history for a specific employee',
        parameters: [
          { in: 'path', name: 'userId', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'startDate', required: true, schema: { type: 'string', format: 'date' }, example: '2026-01-01' },
          { in: 'query', name: 'endDate', required: true, schema: { type: 'string', format: 'date' }, example: '2026-01-31' },
        ],
        responses: { 200: { description: 'Employee info + org config + enriched records' } },
      },
    },
    '/attendance': {
      get: {
        tags: ['Attendance'],
        summary: 'Admin: list all attendance records (org-scoped)',
        parameters: [
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
          { in: 'query', name: 'offset', schema: { type: 'integer', default: 0 } },
          { in: 'query', name: 'userId', schema: { type: 'string' } },
          { in: 'query', name: 'status', schema: { type: 'string', enum: ['CHECKED_IN', 'CHECKED_OUT', 'AUTO_CLOSED', 'MANUALLY_CLOSED'] } },
          { in: 'query', name: 'date', schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Paginated records with total count' } },
      },
    },
    '/attendance/manual': {
      post: {
        tags: ['Attendance'],
        summary: 'Admin: manually create an attendance record',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId', 'checkInTime'],
                properties: {
                  userId: { type: 'string' },
                  checkInTime: { type: 'string', format: 'date-time' },
                  checkOutTime: { type: 'string', format: 'date-time' },
                  note: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Created attendance record' } },
      },
    },
    '/attendance/{id}/edit': {
      put: {
        tags: ['Attendance'],
        summary: 'Admin: edit an attendance record',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  checkInTime: { type: 'string', format: 'date-time' },
                  checkOutTime: { type: 'string', format: 'date-time' },
                  note: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated record' } },
      },
    },
    '/attendance/{id}/acknowledge': {
      put: {
        tags: ['Attendance'],
        summary: 'Admin: acknowledge a corrected attendance record',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Record acknowledged' } },
      },
    },
    '/attendance/mark-present': {
      post: {
        tags: ['Attendance'],
        summary: 'Admin: mark an absent employee as present for a day',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId', 'date'],
                properties: {
                  userId: { type: 'string' },
                  date: { type: 'string', format: 'date' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Attendance record created' } },
      },
    },
    '/attendance/late-arrivals': {
      get: {
        tags: ['Attendance'],
        summary: 'Admin: list late arrivals with statistics',
        parameters: [
          { in: 'query', name: 'range', schema: { type: 'string', enum: ['today', 'week', 'month', 'custom'], default: 'today' } },
          { in: 'query', name: 'fromDate', schema: { type: 'string', format: 'date' }, description: 'Required when range=custom' },
          { in: 'query', name: 'toDate', schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Late arrival records and statistics' } },
      },
    },
    '/attendance/auto-close': {
      post: {
        tags: ['Attendance'],
        summary: 'Admin: manually trigger stale record auto-close job',
        responses: { 200: { description: 'Job result summary' } },
      },
    },

    // ────────────────────────────────────────────────
    // QR CODE
    // ────────────────────────────────────────────────
    '/qr/generate': {
      post: {
        tags: ['QR Code'],
        summary: 'Generate rotating QR code (24h expiry)',
        description: 'ORG_ADMIN strict only. Replaces the current rotating QR.',
        responses: { 200: { description: 'New QR token and data URL' } },
      },
    },
    '/qr/generate-static': {
      post: {
        tags: ['QR Code'],
        summary: 'Generate a static (never-expiring) QR code for printing',
        responses: { 200: { description: 'Static QR token and data URL' } },
      },
    },
    '/qr/regenerate-static': {
      post: {
        tags: ['QR Code'],
        summary: 'Revoke old static QR and issue a new one',
        responses: { 200: { description: 'New static QR token' } },
      },
    },
    '/qr/active': {
      get: {
        tags: ['QR Code'],
        summary: 'Get the current active QR code',
        description: 'ORG_ADMIN and BRANCH_ADMIN can display this at their location.',
        responses: { 200: { description: 'Active QR token and data URL' } },
      },
    },
    '/qr/revoke': {
      post: {
        tags: ['QR Code'],
        summary: 'Revoke all active QR codes for the organization',
        responses: { 200: { description: 'All QR codes revoked' } },
      },
    },

    // ────────────────────────────────────────────────
    // LEAVES
    // ────────────────────────────────────────────────
    '/leaves/balance': {
      get: {
        tags: ['Leaves'],
        summary: 'Employee: get own leave balance for current BS year',
        responses: {
          200: {
            description: 'Leave balance per type with entitlement and used counts',
          },
        },
      },
    },
    '/leaves': {
      get: {
        tags: ['Leaves'],
        summary: 'List leave requests',
        description: 'Employees see their own leaves; admins see the full org list.',
        parameters: [
          { in: 'query', name: 'status', schema: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] } },
          { in: 'query', name: 'type', schema: { type: 'string', enum: ['ANNUAL', 'SICK', 'CASUAL', 'MATERNITY', 'PATERNITY', 'UNPAID'] } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
          { in: 'query', name: 'offset', schema: { type: 'integer', default: 0 } },
        ],
        responses: { 200: { description: 'Leave list' } },
      },
      post: {
        tags: ['Leaves'],
        summary: 'Submit a leave request',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['startDate', 'endDate', 'type', 'reason'],
                properties: {
                  startDate: { type: 'string', format: 'date' },
                  endDate: { type: 'string', format: 'date' },
                  type: { type: 'string', enum: ['ANNUAL', 'SICK', 'CASUAL', 'MATERNITY', 'PATERNITY', 'UNPAID'] },
                  reason: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Leave request created' } },
      },
    },
    '/leaves/{id}': {
      get: {
        tags: ['Leaves'],
        summary: 'Get a single leave request',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Leave details' } },
      },
      delete: {
        tags: ['Leaves'],
        summary: 'Cancel/delete a leave request (employee, PENDING only)',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Leave deleted' } },
      },
    },
    '/leaves/{id}/approve': {
      patch: {
        tags: ['Leaves'],
        summary: 'Admin: approve a leave request',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Leave approved' } },
      },
    },
    '/leaves/{id}/reject': {
      patch: {
        tags: ['Leaves'],
        summary: 'Admin: reject a leave request',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { rejectionMessage: { type: 'string' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Leave rejected' } },
      },
    },

    // ────────────────────────────────────────────────
    // LEAVE BALANCE
    // ────────────────────────────────────────────────
    '/leave-balance/my': {
      get: {
        tags: ['Leave Balance'],
        summary: 'Employee: get own leave balance for a BS year',
        parameters: [{ in: 'query', name: 'bsYear', required: true, schema: { type: 'integer', example: 2082 } }],
        responses: { 200: { description: 'Leave balance or null if feature disabled' } },
      },
    },
    '/leave-balance': {
      get: {
        tags: ['Leave Balance'],
        summary: 'Admin: get all employee balances for the org',
        parameters: [{ in: 'query', name: 'bsYear', required: true, schema: { type: 'integer', example: 2082 } }],
        responses: { 200: { description: 'Array of balances per employee' } },
      },
    },
    '/leave-balance/initialize': {
      post: {
        tags: ['Leave Balance'],
        summary: 'Admin: initialize leave balances for a BS year',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['bsYear'],
                properties: {
                  bsYear: { type: 'integer', example: 2082 },
                  dryRun: { type: 'boolean', default: false, description: 'Preview without writing' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Initialization result' } },
      },
    },
    '/leave-balance/{membershipId}/adjust': {
      put: {
        tags: ['Leave Balance'],
        summary: "Admin: manually adjust an employee's leave balance",
        parameters: [{ in: 'path', name: 'membershipId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['bsYear', 'note'],
                properties: {
                  bsYear: { type: 'integer' },
                  note: { type: 'string', minLength: 3, description: 'Reason for adjustment' },
                  annualUsed: { type: 'integer' },
                  sickUsed: { type: 'integer' },
                  casualUsed: { type: 'integer' },
                  annualCarriedOver: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated balance' } },
      },
    },

    // ────────────────────────────────────────────────
    // PAYROLL
    // ────────────────────────────────────────────────
    '/payroll/my-payslips': {
      get: {
        tags: ['Payroll'],
        summary: 'Employee: list own payslips',
        parameters: [
          { in: 'query', name: 'bsYear', schema: { type: 'integer' } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 12 } },
        ],
        responses: { 200: { description: 'Employee payslip list' } },
      },
    },
    '/payroll/my-payslip/{recordId}/pdf': {
      get: {
        tags: ['Payroll'],
        summary: 'Employee: download own payslip as PDF',
        parameters: [{ in: 'path', name: 'recordId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'PDF file', content: { 'application/pdf': {} } } },
      },
    },
    '/payroll/my-earliest-year': {
      get: {
        tags: ['Payroll'],
        summary: 'Employee: get the earliest BS year with payroll data',
        responses: { 200: { description: 'Earliest BS year' } },
      },
    },
    '/payroll/my-multi-month': {
      get: {
        tags: ['Payroll'],
        summary: 'Employee: multi-month payroll summary',
        responses: { 200: { description: 'Year-to-date payroll data' } },
      },
    },
    '/payroll/settings': {
      get: {
        tags: ['Payroll'],
        summary: 'Admin: get payroll settings for the org',
        responses: { 200: { description: 'Payroll settings' } },
      },
      put: {
        tags: ['Payroll'],
        summary: 'Admin: update payroll settings',
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Updated settings' } },
      },
    },
    '/payroll/generate': {
      post: {
        tags: ['Payroll'],
        summary: 'Admin: generate payroll for a BS month',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['bsYear', 'bsMonth'],
                properties: {
                  bsYear: { type: 'integer', example: 2082 },
                  bsMonth: { type: 'integer', example: 11 },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Generated payroll records' } },
      },
    },
    '/payroll/regenerate/{userId}': {
      post: {
        tags: ['Payroll'],
        summary: 'Admin: regenerate payroll for a single employee',
        parameters: [{ in: 'path', name: 'userId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['bsYear', 'bsMonth'],
                properties: { bsYear: { type: 'integer' }, bsMonth: { type: 'integer' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Regenerated record' } },
      },
    },
    '/payroll/records': {
      get: {
        tags: ['Payroll'],
        summary: 'Admin: list payroll records',
        parameters: [
          { in: 'query', name: 'bsYear', schema: { type: 'integer' } },
          { in: 'query', name: 'bsMonth', schema: { type: 'integer' } },
          { in: 'query', name: 'status', schema: { type: 'string', enum: ['DRAFT', 'APPROVED', 'PAID'] } },
        ],
        responses: { 200: { description: 'Payroll record list' } },
      },
    },
    '/payroll/records/{id}/status': {
      put: {
        tags: ['Payroll'],
        summary: 'Admin: update a payroll record status',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: { status: { type: 'string', enum: ['APPROVED', 'PAID'] } },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated record' } },
      },
    },
    '/payroll/records/{id}/audit': {
      get: {
        tags: ['Payroll'],
        summary: 'Admin: get audit log for a payroll record',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Audit log entries' } },
      },
    },
    '/payroll/records/bulk-status': {
      put: {
        tags: ['Payroll'],
        summary: 'Admin: bulk update payroll record statuses',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ids', 'status'],
                properties: {
                  ids: { type: 'array', items: { type: 'string' } },
                  status: { type: 'string', enum: ['APPROVED', 'PAID'] },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Bulk update result' } },
      },
    },
    '/payroll/multi-month': {
      get: {
        tags: ['Payroll'],
        summary: 'Admin: multi-month payroll summary',
        parameters: [
          { in: 'query', name: 'bsYear', required: true, schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'Summary per month' } },
      },
    },
    '/payroll/multi-month/export': {
      get: {
        tags: ['Payroll'],
        summary: 'Admin: export multi-month payroll as CSV',
        parameters: [{ in: 'query', name: 'bsYear', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'CSV file', content: { 'text/csv': {} } } },
      },
    },
    '/payroll/payslip/{recordId}/pdf': {
      get: {
        tags: ['Payroll'],
        summary: 'Admin: download a payslip PDF for any employee',
        parameters: [{ in: 'path', name: 'recordId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'PDF payslip', content: { 'application/pdf': {} } } },
      },
    },
    '/payroll/export/detailed': {
      get: {
        tags: ['Payroll'],
        summary: 'Admin: export detailed payroll as Excel/CSV',
        parameters: [
          { in: 'query', name: 'bsYear', required: true, schema: { type: 'integer' } },
          { in: 'query', name: 'bsMonth', required: true, schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'Detailed payroll export file' } },
      },
    },
    '/payroll/export/bank-sheet': {
      get: {
        tags: ['Payroll'],
        summary: 'Admin: export bank payment sheet',
        parameters: [
          { in: 'query', name: 'bsYear', required: true, schema: { type: 'integer' } },
          { in: 'query', name: 'bsMonth', required: true, schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'Bank sheet file' } },
      },
    },
    '/payroll/annual-report': {
      get: {
        tags: ['Payroll'],
        summary: 'Admin: annual payroll report',
        parameters: [{ in: 'query', name: 'bsYear', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Annual report data' } },
      },
    },
    '/payroll/annual-report/csv': {
      get: {
        tags: ['Payroll'],
        summary: 'Admin: export annual payroll report as CSV',
        parameters: [{ in: 'query', name: 'bsYear', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'CSV file', content: { 'text/csv': {} } } },
      },
    },
    '/payroll/tds-slabs': {
      get: {
        tags: ['Payroll'],
        summary: 'Get current TDS slabs',
        responses: { 200: { description: 'TDS slab configuration' } },
      },
    },

    // ────────────────────────────────────────────────
    // REPORTS
    // ────────────────────────────────────────────────
    '/reports/daily': {
      get: {
        tags: ['Reports'],
        summary: 'Daily attendance report',
        parameters: [
          { in: 'query', name: 'date', schema: { type: 'string', format: 'date' }, description: 'Defaults to today' },
          { in: 'query', name: 'branchId', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Present / absent / late breakdown for the day' } },
      },
    },
    '/reports/weekly': {
      get: {
        tags: ['Reports'],
        summary: 'Weekly attendance report',
        parameters: [
          { in: 'query', name: 'startDate', schema: { type: 'string', format: 'date' }, description: 'Defaults to start of current week' },
          { in: 'query', name: 'branchId', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Weekly summary per employee' } },
      },
    },
    '/reports/monthly': {
      get: {
        tags: ['Reports'],
        summary: 'Monthly attendance report',
        parameters: [
          { in: 'query', name: 'year', schema: { type: 'integer' }, description: 'AD year, defaults to current year' },
          { in: 'query', name: 'month', schema: { type: 'integer', minimum: 1, maximum: 12 } },
          { in: 'query', name: 'branchId', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Monthly summary per employee' } },
      },
    },
    '/reports/roster': {
      get: {
        tags: ['Reports'],
        summary: 'Generate printable duty roster as PDF',
        parameters: [
          { in: 'query', name: 'period', schema: { type: 'string', enum: ['weekly', 'fortnightly', 'monthly'], default: 'weekly' } },
          { in: 'query', name: 'includeTime', schema: { type: 'boolean', default: false }, description: 'Include shift start/end times' },
        ],
        responses: { 200: { description: 'PDF roster', content: { 'application/pdf': {} } } },
      },
    },

    // ────────────────────────────────────────────────
    // HOLIDAYS
    // ────────────────────────────────────────────────
    '/holidays': {
      get: {
        tags: ['Holidays'],
        summary: 'List organization holidays',
        parameters: [
          { in: 'query', name: 'bsYear', schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'Holiday list' } },
      },
      post: {
        tags: ['Holidays'],
        summary: 'Create a custom holiday for the organization',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'date', 'bsYear', 'bsMonth', 'bsDay', 'type'],
                properties: {
                  name: { type: 'string' },
                  nameNepali: { type: 'string' },
                  date: { type: 'string', format: 'date' },
                  bsYear: { type: 'integer' },
                  bsMonth: { type: 'integer' },
                  bsDay: { type: 'integer' },
                  type: { type: 'string', enum: ['PUBLIC_HOLIDAY', 'OPTIONAL_HOLIDAY', 'COMPANY_EVENT'] },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Holiday created' } },
      },
    },
    '/holidays/master': {
      get: {
        tags: ['Holidays'],
        summary: 'Get national holidays available for import',
        parameters: [{ in: 'query', name: 'bsYear', schema: { type: 'integer' } }],
        responses: { 200: { description: 'Master holidays with alreadyImported flag' } },
      },
    },
    '/holidays/import': {
      post: {
        tags: ['Holidays'],
        summary: 'Import national holidays into the organization',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['bsYear'], properties: { bsYear: { type: 'integer' } } },
            },
          },
        },
        responses: { 200: { description: 'Import summary (imported / skipped)' } },
      },
    },
    '/holidays/sync': {
      post: {
        tags: ['Holidays'],
        summary: 'Sync national holidays for a BS year',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['bsYear'], properties: { bsYear: { type: 'integer' } } },
            },
          },
        },
        responses: { 200: { description: 'Sync result' } },
      },
    },
    '/holidays/{id}': {
      put: {
        tags: ['Holidays'],
        summary: 'Update a holiday (toggle active)',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { isActive: { type: 'boolean' } } } } },
        },
        responses: { 200: { description: 'Updated holiday' } },
      },
      delete: {
        tags: ['Holidays'],
        summary: 'Delete an organization holiday',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' } },
      },
    },

    // ────────────────────────────────────────────────
    // MASTER HOLIDAYS (Super Admin)
    // ────────────────────────────────────────────────
    '/master-holidays': {
      get: {
        tags: ['Master Holidays'],
        summary: 'List master (national) holidays',
        parameters: [{ in: 'query', name: 'bsYear', schema: { type: 'integer' } }],
        responses: { 200: { description: 'National holiday list' } },
      },
      post: {
        tags: ['Master Holidays'],
        summary: 'Super Admin: add a national holiday',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'date', 'bsYear', 'bsMonth', 'bsDay'],
                properties: {
                  name: { type: 'string' },
                  nameNepali: { type: 'string' },
                  date: { type: 'string', format: 'date' },
                  bsYear: { type: 'integer' },
                  bsMonth: { type: 'integer' },
                  bsDay: { type: 'integer' },
                  type: { type: 'string', enum: ['PUBLIC_HOLIDAY', 'OPTIONAL_HOLIDAY', 'COMPANY_EVENT'] },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Master holiday created' } },
      },
    },
    '/master-holidays/sync': {
      post: {
        tags: ['Master Holidays'],
        summary: 'Super Admin: sync master holidays for a BS year',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['bsYear'], properties: { bsYear: { type: 'integer' } } },
            },
          },
        },
        responses: { 200: { description: 'Sync result' } },
      },
    },
    '/master-holidays/stats/{bsYear}': {
      get: {
        tags: ['Master Holidays'],
        summary: 'Super Admin: holiday stats for a BS year',
        parameters: [{ in: 'path', name: 'bsYear', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Stats' } },
      },
    },
    '/master-holidays/{id}': {
      patch: {
        tags: ['Master Holidays'],
        summary: 'Super Admin: update a master holiday',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { name: { type: 'string' }, isActive: { type: 'boolean' } } },
            },
          },
        },
        responses: { 200: { description: 'Updated' } },
      },
      delete: {
        tags: ['Master Holidays'],
        summary: 'Super Admin: delete a master holiday',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' } },
      },
    },

    // ────────────────────────────────────────────────
    // ORG SETTINGS
    // ────────────────────────────────────────────────
    '/org-settings': {
      get: {
        tags: ['Org Settings'],
        summary: 'Get organization settings',
        responses: { 200: { description: 'Full org settings object' } },
      },
      put: {
        tags: ['Org Settings'],
        summary: 'Update organization settings',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string' },
                  phone: { type: 'string' },
                  address: { type: 'string' },
                  workStartTime: { type: 'string', example: '10:00' },
                  workEndTime: { type: 'string', example: '18:00' },
                  lateThresholdMinutes: { type: 'integer' },
                  geofenceEnabled: { type: 'boolean' },
                  officeLat: { type: 'number' },
                  officeLng: { type: 'number' },
                  geofenceRadius: { type: 'integer' },
                  attendanceMode: { type: 'string', enum: ['QR_ONLY', 'GPS_ONLY', 'BOTH'] },
                  workingDays: { type: 'string', example: '0,1,2,3,4,5', description: 'Comma-separated day numbers (0=Sun)' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated settings' } },
      },
    },
    '/org-settings/subscription': {
      get: {
        tags: ['Org Settings'],
        summary: 'Get organization subscription details',
        responses: { 200: { description: 'Subscription with plan details' } },
      },
    },

    // ────────────────────────────────────────────────
    // CONFIG
    // ────────────────────────────────────────────────
    '/config': {
      get: {
        tags: ['Config'],
        summary: 'List all system config keys for the organization',
        responses: { 200: { description: 'Config key-value pairs' } },
      },
    },
    '/config/{key}': {
      put: {
        tags: ['Config'],
        summary: 'Update a config value',
        parameters: [{ in: 'path', name: 'key', required: true, schema: { type: 'string' }, example: 'scan_cooldown_minutes' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['value'], properties: { value: { type: 'string' } } },
            },
          },
        },
        responses: { 200: { description: 'Updated config entry' } },
      },
    },

    // ────────────────────────────────────────────────
    // NOTIFICATIONS
    // ────────────────────────────────────────────────
    '/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'List all notifications (paginated)',
        parameters: [
          { in: 'query', name: 'skip', schema: { type: 'integer', default: 0 } },
          { in: 'query', name: 'take', schema: { type: 'integer', default: 50 } },
        ],
        responses: { 200: { description: 'Paginated notifications' } },
      },
    },
    '/notifications/unread': {
      get: {
        tags: ['Notifications'],
        summary: 'List unread notifications',
        responses: { 200: { description: 'Unread notifications' } },
      },
    },
    '/notifications/count': {
      get: {
        tags: ['Notifications'],
        summary: 'Get unread notification count',
        responses: {
          200: {
            description: 'Count',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { data: { type: 'object', properties: { count: { type: 'integer' } } } } },
              },
            },
          },
        },
      },
    },
    '/notifications/read-all': {
      put: {
        tags: ['Notifications'],
        summary: 'Mark all notifications as read',
        responses: { 200: { description: 'All marked as read' } },
      },
    },
    '/notifications/clear-read': {
      delete: {
        tags: ['Notifications'],
        summary: 'Delete all read notifications',
        responses: { 200: { description: 'Cleared' } },
      },
    },
    '/notifications/clear-late-arrivals': {
      post: {
        tags: ['Notifications'],
        summary: 'Clear all late arrival notifications',
        responses: { 200: { description: 'Number of cleared notifications' } },
      },
    },
    '/notifications/{id}/read': {
      put: {
        tags: ['Notifications'],
        summary: 'Mark a single notification as read',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Marked as read' } },
      },
    },
    '/notifications/{id}': {
      delete: {
        tags: ['Notifications'],
        summary: 'Delete a notification',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' } },
      },
    },

    // ────────────────────────────────────────────────
    // DOCUMENTS
    // ────────────────────────────────────────────────
    '/documents': {
      post: {
        tags: ['Documents'],
        summary: 'Upload a document for an employee',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file', 'userId', 'documentTypeId'],
                properties: {
                  file: { type: 'string', format: 'binary' },
                  userId: { type: 'string' },
                  documentTypeId: { type: 'string' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Document uploaded' } },
      },
    },
    '/documents/user/{id}': {
      get: {
        tags: ['Documents'],
        summary: 'List documents for a user',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'User document list' } },
      },
    },
    '/documents/{id}/download': {
      get: {
        tags: ['Documents'],
        summary: 'Download a document',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Pre-signed download URL or file stream' } },
      },
    },
    '/documents/{id}': {
      delete: {
        tags: ['Documents'],
        summary: 'Delete a document',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' } },
      },
    },

    // ────────────────────────────────────────────────
    // DOCUMENT TYPES
    // ────────────────────────────────────────────────
    '/org/document-types': {
      get: {
        tags: ['Document Types'],
        summary: 'List document types for the organization',
        responses: { 200: { description: 'Document type list' } },
      },
      post: {
        tags: ['Document Types'],
        summary: 'Admin: create a document type',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  nameNp: { type: 'string' },
                  isRequired: { type: 'boolean', default: false },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Document type created' } },
      },
    },
    '/org/document-types/{id}': {
      patch: {
        tags: ['Document Types'],
        summary: 'Admin: update a document type',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string' }, isRequired: { type: 'boolean' }, isActive: { type: 'boolean' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated' } },
      },
      delete: {
        tags: ['Document Types'],
        summary: 'Admin: delete a document type',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' } },
      },
    },
    '/org/document-compliance': {
      get: {
        tags: ['Document Types'],
        summary: 'Admin: get document compliance overview (which employees are missing required docs)',
        responses: { 200: { description: 'Compliance report' } },
      },
    },

    // ────────────────────────────────────────────────
    // ROSTER
    // ────────────────────────────────────────────────
    '/roster': {
      get: {
        tags: ['Roster'],
        summary: 'List all roster schedules for the organization',
        responses: { 200: { description: 'Roster list' } },
      },
    },
    '/roster/my': {
      get: {
        tags: ['Roster'],
        summary: 'Employee: get own roster schedule',
        responses: { 200: { description: 'Current employee schedule' } },
      },
    },
    '/roster/{membershipId}': {
      get: {
        tags: ['Roster'],
        summary: 'Admin: get roster for a specific employee',
        parameters: [{ in: 'path', name: 'membershipId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Employee roster' } },
      },
      post: {
        tags: ['Roster'],
        summary: 'Admin: set roster for an employee',
        parameters: [{ in: 'path', name: 'membershipId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  workingDays: { type: 'string', example: '0,1,2,3,4', description: 'Comma-separated day numbers' },
                  shiftStartTime: { type: 'string', example: '09:00' },
                  shiftEndTime: { type: 'string', example: '17:00' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Roster set' } },
      },
      put: {
        tags: ['Roster'],
        summary: 'Admin: update an employee roster',
        parameters: [{ in: 'path', name: 'membershipId', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { 200: { description: 'Updated roster' } },
      },
      delete: {
        tags: ['Roster'],
        summary: 'Admin: delete an employee roster (reverts to org defaults)',
        parameters: [{ in: 'path', name: 'membershipId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' } },
      },
    },

    // ────────────────────────────────────────────────
    // FIELD TRACKING
    // ────────────────────────────────────────────────
    '/field-tracking': {
      post: {
        tags: ['Field Tracking'],
        summary: 'Log a GPS location for the authenticated field staff employee',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['latitude', 'longitude'],
                properties: {
                  latitude: { type: 'number' },
                  longitude: { type: 'number' },
                  accuracy: { type: 'number' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Location logged' } },
      },
      get: {
        tags: ['Field Tracking'],
        summary: 'Admin: list field staff location logs',
        parameters: [
          { in: 'query', name: 'userId', schema: { type: 'string' } },
          { in: 'query', name: 'date', schema: { type: 'string', format: 'date' } },
          { in: 'query', name: 'branchId', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Location log entries' } },
      },
    },
    '/field-tracking/live': {
      get: {
        tags: ['Field Tracking'],
        summary: 'Admin: live positions of all field staff (latest ping per employee)',
        responses: { 200: { description: 'Latest location per field employee' } },
      },
    },

    // ────────────────────────────────────────────────
    // BRANCHES
    // ────────────────────────────────────────────────
    '/branches': {
      get: {
        tags: ['Branches'],
        summary: 'List branches visible to the requester',
        description: 'ORG_ADMIN sees all branches; BRANCH_ADMIN sees only their own.',
        parameters: [
          { in: 'query', name: 'includeDeleted', schema: { type: 'boolean' }, description: 'ORG_ADMIN only' },
        ],
        responses: { 200: { description: 'Branch list' } },
      },
    },
    '/branches/{id}/geofence': {
      put: {
        tags: ['Branches'],
        summary: 'Admin: update branch geofence settings',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  officeLat: { type: 'number' },
                  officeLng: { type: 'number' },
                  geofenceRadius: { type: 'integer', description: 'Radius in metres' },
                  geofenceEnabled: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated branch' } },
      },
    },

    // ────────────────────────────────────────────────
    // NEPALI DATE
    // ────────────────────────────────────────────────
    '/nepali-date/ad-to-bs': {
      get: {
        tags: ['Nepali Date'],
        summary: 'Convert AD date to BS (Bikram Sambat)',
        security: [],
        parameters: [{ in: 'query', name: 'date', required: true, schema: { type: 'string', format: 'date' }, example: '2026-05-24' }],
        responses: { 200: { description: 'BS year, month, day' } },
      },
    },
    '/nepali-date/bs-to-ad': {
      get: {
        tags: ['Nepali Date'],
        summary: 'Convert BS date to AD',
        security: [],
        parameters: [
          { in: 'query', name: 'year', required: true, schema: { type: 'integer' }, example: 2082 },
          { in: 'query', name: 'month', required: true, schema: { type: 'integer' }, example: 2 },
          { in: 'query', name: 'day', required: true, schema: { type: 'integer' }, example: 10 },
        ],
        responses: { 200: { description: 'AD date string' } },
      },
    },

    // ────────────────────────────────────────────────
    // SUPER ADMIN — ORGANIZATIONS
    // ────────────────────────────────────────────────
    '/super-admin/stats': {
      get: {
        tags: ['Super Admin – Orgs'],
        summary: 'Platform-wide statistics',
        responses: { 200: { description: 'Total orgs, employees, active subscriptions, etc.' } },
      },
    },
    '/super-admin/organizations': {
      get: {
        tags: ['Super Admin – Orgs'],
        summary: 'List all organizations',
        responses: { 200: { description: 'All organizations' } },
      },
      post: {
        tags: ['Super Admin – Orgs'],
        summary: 'Create a new organization and its admin',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'adminEmail', 'adminFirstName', 'adminLastName'],
                properties: {
                  name: { type: 'string' },
                  slug: { type: 'string' },
                  email: { type: 'string' },
                  adminEmail: { type: 'string', format: 'email' },
                  adminFirstName: { type: 'string' },
                  adminLastName: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Organization and admin created' } },
      },
    },
    '/super-admin/organizations/{id}': {
      get: {
        tags: ['Super Admin – Orgs'],
        summary: 'Get a specific organization',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Organization details' } },
      },
      patch: {
        tags: ['Super Admin – Orgs'],
        summary: 'Update an organization',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { 200: { description: 'Updated organization' } },
      },
      delete: {
        tags: ['Super Admin – Orgs'],
        summary: 'Deactivate an organization',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Organization deactivated' } },
      },
    },
    '/super-admin/organizations/{id}/toggle-status': {
      patch: {
        tags: ['Super Admin – Orgs'],
        summary: 'Toggle organization active/inactive',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Updated status' } },
      },
    },
    '/super-admin/tds-slabs': {
      get: {
        tags: ['Super Admin – Orgs'],
        summary: 'Get global TDS slab configuration',
        responses: { 200: { description: 'TDS slabs' } },
      },
      put: {
        tags: ['Super Admin – Orgs'],
        summary: 'Update global TDS slabs',
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Updated slabs' } },
      },
    },

    // ────────────────────────────────────────────────
    // SUPER ADMIN — SUBSCRIPTIONS
    // ────────────────────────────────────────────────
    '/super-admin/subscriptions': {
      get: {
        tags: ['Super Admin – Subscriptions'],
        summary: 'List all subscriptions',
        parameters: [
          { in: 'query', name: 'status', schema: { type: 'string' } },
          { in: 'query', name: 'search', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
          { in: 'query', name: 'offset', schema: { type: 'integer', default: 0 } },
        ],
        responses: { 200: { description: 'Subscription list' } },
      },
    },
    '/super-admin/subscriptions/run-trial-job': {
      post: {
        tags: ['Super Admin – Subscriptions'],
        summary: 'Manually trigger the trial expiry job',
        responses: { 200: { description: 'Job completed' } },
      },
    },
    '/super-admin/subscriptions/{organizationId}': {
      get: {
        tags: ['Super Admin – Subscriptions'],
        summary: 'Get subscription for an organization',
        parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Subscription details' } },
      },
    },
    '/super-admin/subscriptions/{organizationId}/assign-tier': {
      post: {
        tags: ['Super Admin – Subscriptions'],
        summary: 'Assign a pricing tier to an organization',
        parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tier'],
                properties: {
                  tier: { type: 'string', enum: ['OPERATIONS'] },
                  billingCycle: { type: 'string', enum: ['MONTHLY'] },
                  startTrial: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Tier assigned' } },
      },
    },
    '/super-admin/subscriptions/{organizationId}/override-pricing': {
      patch: {
        tags: ['Super Admin – Subscriptions'],
        summary: 'Override pricing for an organization',
        parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  customPricePerEmployee: { type: 'number' },
                  isPriceLockedForever: { type: 'boolean' },
                  note: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Pricing overridden' } },
      },
    },
    '/super-admin/subscriptions/{organizationId}/waive-setup-fee': {
      patch: {
        tags: ['Super Admin – Subscriptions'],
        summary: 'Waive the setup fee for an organization',
        parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { note: { type: 'string' } } },
            },
          },
        },
        responses: { 200: { description: 'Setup fee waived' } },
      },
    },
    '/super-admin/subscriptions/{organizationId}/suspend': {
      patch: {
        tags: ['Super Admin – Subscriptions'],
        summary: 'Suspend a subscription',
        parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } },
            },
          },
        },
        responses: { 200: { description: 'Subscription suspended' } },
      },
    },
    '/super-admin/subscriptions/{organizationId}/reactivate': {
      patch: {
        tags: ['Super Admin – Subscriptions'],
        summary: 'Reactivate a suspended subscription',
        parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { note: { type: 'string' } } },
            },
          },
        },
        responses: { 200: { description: 'Reactivated' } },
      },
    },
    '/super-admin/subscriptions/{organizationId}/extend-trial': {
      patch: {
        tags: ['Super Admin – Subscriptions'],
        summary: 'Extend trial period',
        parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['days'],
                properties: {
                  days: { type: 'integer', minimum: 1, maximum: 365 },
                  note: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Trial extended' } },
      },
    },
    '/super-admin/subscriptions/{organizationId}/mark-expired': {
      patch: {
        tags: ['Super Admin – Subscriptions'],
        summary: 'Mark a suspended subscription as expired',
        parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } },
            },
          },
        },
        responses: { 200: { description: 'Marked expired' } },
      },
    },
    '/super-admin/subscriptions/{organizationId}/notes': {
      post: {
        tags: ['Super Admin – Subscriptions'],
        summary: 'Add a note to a subscription',
        parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['note'], properties: { note: { type: 'string' } } },
            },
          },
        },
        responses: { 201: { description: 'Note added' } },
      },
    },
    '/super-admin/subscriptions/{organizationId}/billing-log': {
      get: {
        tags: ['Super Admin – Subscriptions'],
        summary: 'Get billing log for an organization',
        parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Billing log entries' } },
      },
    },
    '/super-admin/subscriptions/{organizationId}/feature-overrides': {
      patch: {
        tags: ['Super Admin – Subscriptions'],
        summary: 'Override feature flags for an organization',
        parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: 'Boolean or null values for any feature flag override field',
                example: { overrideFeatureLeave: true, overrideFeatureFullPayroll: null },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated subscription with overrides' } },
      },
    },

    // ────────────────────────────────────────────────
    // SUPER ADMIN — PLANS
    // ────────────────────────────────────────────────
    '/super-admin/plans': {
      get: {
        tags: ['Super Admin – Plans'],
        summary: 'List all pricing plans',
        responses: { 200: { description: 'Plan list' } },
      },
    },
    '/super-admin/plans/{tier}/features': {
      patch: {
        tags: ['Super Admin – Plans'],
        summary: 'Update feature flags for a plan tier',
        parameters: [{ in: 'path', name: 'tier', required: true, schema: { type: 'string', example: 'OPERATIONS' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', description: 'Boolean values for feature flag fields', example: { featureLeave: true } },
            },
          },
        },
        responses: { 200: { description: 'Updated plan' } },
      },
    },
    '/super-admin/plans/{tier}/price': {
      patch: {
        tags: ['Super Admin – Plans'],
        summary: 'Update price per employee for a plan tier',
        parameters: [{ in: 'path', name: 'tier', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['pricePerEmployee'], properties: { pricePerEmployee: { type: 'number', minimum: 0 } } },
            },
          },
        },
        responses: { 200: { description: 'Updated plan' } },
      },
    },
    '/super-admin/plans/{tier}/setup-fee': {
      patch: {
        tags: ['Super Admin – Plans'],
        summary: 'Update default setup fee for a plan tier',
        parameters: [{ in: 'path', name: 'tier', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', properties: { defaultSetupFee: { type: 'number', nullable: true, minimum: 0 } } },
            },
          },
        },
        responses: { 200: { description: 'Updated plan' } },
      },
    },
    '/super-admin/plans/{tier}/trial-days': {
      patch: {
        tags: ['Super Admin – Plans'],
        summary: 'Update trial days for a plan tier',
        parameters: [{ in: 'path', name: 'tier', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['days'], properties: { days: { type: 'integer', minimum: 0 } } },
            },
          },
        },
        responses: { 200: { description: 'Updated plan' } },
      },
    },
    '/super-admin/plans/{tier}/grace-period': {
      patch: {
        tags: ['Super Admin – Plans'],
        summary: 'Update grace period days for a plan tier',
        parameters: [{ in: 'path', name: 'tier', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['gracePeriodDays'], properties: { gracePeriodDays: { type: 'integer', minimum: 1 } } },
            },
          },
        },
        responses: { 200: { description: 'Updated plan' } },
      },
    },
    '/super-admin/plans/{tier}/annual-discount': {
      patch: {
        tags: ['Super Admin – Plans'],
        summary: 'Update annual billing discount for a plan tier',
        parameters: [{ in: 'path', name: 'tier', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['annualDiscountPercent'],
                properties: { annualDiscountPercent: { type: 'integer', minimum: 0, maximum: 100 } },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated plan' } },
      },
    },

    // ────────────────────────────────────────────────
    // SUPER ADMIN — PLATFORM CONFIG
    // ────────────────────────────────────────────────
    '/super-admin/platform-config': {
      get: {
        tags: ['Super Admin – Platform Config'],
        summary: 'List all platform config keys',
        responses: { 200: { description: 'Key-value list' } },
      },
    },
    '/super-admin/platform-config/{key}': {
      get: {
        tags: ['Super Admin – Platform Config'],
        summary: 'Get a single platform config value',
        parameters: [{ in: 'path', name: 'key', required: true, schema: { type: 'string' }, example: 'trial_duration_days' }],
        responses: { 200: { description: 'Config entry' } },
      },
      patch: {
        tags: ['Super Admin – Platform Config'],
        summary: 'Update a platform config value',
        parameters: [{ in: 'path', name: 'key', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['value'], properties: { value: { type: 'string' } } },
            },
          },
        },
        responses: { 200: { description: 'Updated config entry' } },
      },
    },

    // ────────────────────────────────────────────────
    // SUPER ADMIN — BRANCHES
    // ────────────────────────────────────────────────
    '/super-admin/branches': {
      get: {
        tags: ['Super Admin – Branches'],
        summary: 'Super Admin: list all branches across all organizations',
        responses: { 200: { description: 'All branches' } },
      },
      post: {
        tags: ['Super Admin – Branches'],
        summary: 'Super Admin: create a branch for an organization',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'organizationId'],
                properties: {
                  name: { type: 'string' },
                  organizationId: { type: 'string' },
                  officeLat: { type: 'number' },
                  officeLng: { type: 'number' },
                  geofenceRadius: { type: 'integer' },
                  geofenceEnabled: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Branch created' } },
      },
    },
    '/super-admin/branches/{id}': {
      patch: {
        tags: ['Super Admin – Branches'],
        summary: 'Super Admin: update a branch',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Updated branch' } },
      },
      delete: {
        tags: ['Super Admin – Branches'],
        summary: 'Super Admin: soft-delete a branch',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Branch deleted' } },
      },
    },
  },
};

export function setupSwagger(app: Express): void {
  const options: swaggerUi.SwaggerUiOptions = {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Attend-Xpress API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      defaultModelsExpandDepth: -1,
      requestInterceptor: (request: any) => {
        request.headers['X-Requested-With'] = 'XMLHttpRequest';
        return request;
      },
    },
  };

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec, options));

  // Serve raw JSON spec for tooling (Postman, code-gen, etc.)
  app.get('/api-docs.json', (_req, res) => res.json(spec));
}
