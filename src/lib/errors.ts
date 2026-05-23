// Custom error classes for the application

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 400, code || 'VALIDATION_ERROR');
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', code?: string) {
    super(message, 401, code || 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied', code?: string) {
    super(message, 403, code || 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', code?: string) {
    super(message, 404, code || 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 409, code || 'CONFLICT');
  }
}

// Prisma error handler — converts Prisma errors to AppErrors
export function handlePrismaError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const prismaError = error as { code?: string; meta?: { target?: string[] } };

  if (prismaError.code === 'P2002') {
    const target = prismaError.meta?.target?.join(', ') || 'field';
    return new ConflictError(
      `A record with this ${target} already exists`,
      'DUPLICATE_ENTRY'
    );
  }

  if (prismaError.code === 'P2025') {
    return new NotFoundError('Record not found', 'RECORD_NOT_FOUND');
  }

  return new AppError('An unexpected error occurred', 500, 'INTERNAL_ERROR');
}
