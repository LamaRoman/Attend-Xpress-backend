# Attend-Xpress Backend

A multi-tenant smart attendance system backend built for Nepal, supporting QR-based check-in, leave management, payroll (with Nepal-specific statutory deductions), and Bikram Sambat calendar.

## Tech Stack

- **Runtime**: Node.js >= 20
- **Language**: TypeScript
- **Framework**: Express.js v5
- **Database**: PostgreSQL (via Prisma ORM)
- **Cache**: Redis (optional — falls back to in-memory)
- **Storage**: AWS S3 (optional — for employee documents)
- **Email**: Resend (optional — for password reset & notifications)
- **API Docs**: Swagger UI at `/api-docs`

---

## Prerequisites

- Node.js >= 20
- PostgreSQL database
- Redis (optional but recommended for production)

---

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd Attend-Xpress-backend

# Install dependencies
npm install
```

---

## Environment Setup

Copy the example below and create a `.env` file in the project root:

```env
# ── Required ──────────────────────────────────────────────────
DATABASE_URL="postgresql://postgres:password@localhost:5432/smart_attendance"

JWT_SECRET="your-secret-key-at-least-32-characters-long"
JWT_EXPIRES_IN="7d"
REFRESH_TOKEN_SECRET="your-refresh-secret-key"

QR_SECRET="your-qr-secret-key"
TOTP_ISSUER="AttendXpress"

NODE_ENV="development"
PORT="5001"

CORS_ORIGINS="http://localhost:3000"
FRONTEND_URL="http://localhost:3000"

TZ=Asia/Kathmandu

# ── Seed credentials (used by db:seed) ────────────────────────
SUPER_ADMIN_EMAIL="admin@yourcompany.com"
SUPER_ADMIN_PASSWORD="SuperAdmin@123"
SEED_ORG_ADMIN_PASSWORD="OrgAdmin@1234"
SEED_EMPLOYEE_PASSWORD="Employee@1234"
SEED_EMPLOYEE_PIN="1234"

# ── Optional: Redis ───────────────────────────────────────────
# REDIS_URL="redis://localhost:6379"

# ── Optional: AWS S3 (employee document storage) ──────────────
# AWS_ACCESS_KEY_ID="your-key"
# AWS_SECRET_ACCESS_KEY="your-secret"
# AWS_REGION="ap-south-1"
# AWS_S3_BUCKET="smart-hr-documents"

# ── Optional: Email (Resend) ──────────────────────────────────
# RESEND_API_KEY="re_xxxxxxxxxxxx"
# RESEND_FROM_EMAIL="noreply@yourdomain.com"

# ── Optional: Nepal public holidays sync ─────────────────────
# CALENDARIFIC_API_KEY="your-api-key"

# ── Optional: Slack alerts for cron job failures ──────────────
# SLACK_ALERT_WEBHOOK_URL="https://hooks.slack.com/..."
```

---

## Database Setup

```bash
# Run migrations
npm run db:migrate

# Seed the database with initial data (super admin + sample org)
npm run db:seed

# Optional: seed Nepal public holidays
npx tsx prisma/seed-holidays.ts

# Optional: seed platform config defaults
npx tsx prisma/seed-platform-config.ts
```

---

## Running the App

```bash
# Development (hot reload)
npm run dev

# Production build
npm run build
npm run start
```

The server starts on `http://localhost:5001` by default.

---

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run migrations then start production server |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:migrate` | Apply pending database migrations |
| `npm run db:push` | Push schema changes without a migration file |
| `npm run db:seed` | Seed the database with initial data |
| `npm test` | Run test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |

---

## API Overview

All endpoints are prefixed with `/api/v1`.

| Prefix | Description |
|---|---|
| `/auth` | Login, logout, password reset, token refresh |
| `/users` | User profile management |
| `/attendance` | Clock-in/out via QR scan or mobile check-in |
| `/qr` | QR code generation and management |
| `/leaves` | Leave requests and approvals |
| `/leave-balance` | Annual leave balance tracking |
| `/payroll` | Monthly payroll calculation and workflow |
| `/reports` | Attendance and payroll reports |
| `/holidays` | Organization-specific holiday management |
| `/master-holidays` | Platform-wide national holidays |
| `/org-settings` | Organization configuration |
| `/branches` | Branch management |
| `/roster` | Employee roster scheduling |
| `/field-tracking` | GPS location tracking for field staff |
| `/notifications` | In-app notifications |
| `/documents` | Employee document uploads |
| `/super-admin` | Platform-level admin operations |

### Health Check

```
GET /api/v1/health
```

Returns database and Redis connection status.

### Swagger Docs

Available at `http://localhost:5001/api-docs` when the server is running.

---

## User Roles

| Role | Description |
|---|---|
| `SUPER_ADMIN` | Platform-level admin — manages all organizations |
| `ORG_ADMIN` | Organization admin — manages their org and employees |
| `ORG_ACCOUNTANT` | Access to payroll and reports |
| `BRANCH_ADMIN` | Manages only their assigned branch |
| `EMPLOYEE` | Regular employee — attendance and leave only |

---

## Docker

```bash
# Build the image
docker build -t attend-xpress-backend .

# Run with environment variables
docker run -p 5001:5001 \
  -e DATABASE_URL="postgresql://..." \
  -e JWT_SECRET="..." \
  -e REFRESH_TOKEN_SECRET="..." \
  attend-xpress-backend
```

The container runs migrations automatically on start (`prisma migrate deploy`).

A health check is configured at `/api/v1/health` with a 30-second interval.

---

## Key Features

- **QR Attendance** — Static and rotating QR codes with configurable expiry
- **Mobile Check-in** — GPS-based geofence check-in
- **Multi-tenant** — Full data isolation per organization with branch support
- **Nepali Calendar** — Bikram Sambat (BS) date support throughout
- **Leave Management** — Multiple leave types with balance tracking (Nepal Labor Act 2074)
- **Payroll** — Nepal-specific deductions: SSF, PF, CIT, TDS, Dashain bonus
- **Field Staff Tracking** — Real-time GPS pings during shift
- **Subscriptions** — Tiered plans with trial, billing, and grace period automation
- **Audit Logs** — Immutable attendance and payroll audit trail
