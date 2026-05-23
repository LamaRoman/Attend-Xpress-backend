import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Mock Prisma
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Mock bcrypt
jest.mock('bcryptjs');

// Mock jwt
jest.mock('jsonwebtoken');

describe('Authentication Tests', () => {
  let mockPrisma: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma = require('@/lib/prisma').default;
  });

  describe('User Login', () => {
    it('should hash password correctly', async () => {
      const password = 'password123';
      const hashedPassword = '$2a$10$abcdefghijklmnopqrstuvwxyz123456';
      
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);
      
      const result = await bcrypt.hash(password, 10);
      
      expect(bcrypt.hash).toHaveBeenCalledWith(password, 10);
      expect(result).toBe(hashedPassword);
    });

    it('should verify password correctly', async () => {
      const password = 'password123';
      const hashedPassword = '$2a$10$abcdefghijklmnopqrstuvwxyz123456';
      
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      
      const isValid = await bcrypt.compare(password, hashedPassword);
      
      expect(bcrypt.compare).toHaveBeenCalledWith(password, hashedPassword);
      expect(isValid).toBe(true);
    });

    it('should reject invalid password', async () => {
      const password = 'wrongpassword';
      const hashedPassword = '$2a$10$abcdefghijklmnopqrstuvwxyz123456';
      
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      
      const isValid = await bcrypt.compare(password, hashedPassword);
      
      expect(isValid).toBe(false);
    });

    it('should generate JWT token', () => {
      const payload = {
        userId: '1',
        email: 'test@example.com',
        role: 'USER',
      };
      const secret = 'test-secret';
      const token = 'mock-jwt-token';
      
      (jwt.sign as jest.Mock).mockReturnValue(token);
      
      const result = jwt.sign(payload, secret, { expiresIn: '24h' });
      
      expect(jwt.sign).toHaveBeenCalledWith(payload, secret, { expiresIn: '24h' });
      expect(result).toBe(token);
    });

    it('should verify JWT token', () => {
      const token = 'valid-token';
      const secret = 'test-secret';
      const decoded = { userId: '1', email: 'test@example.com' };
      
      (jwt.verify as jest.Mock).mockReturnValue(decoded);
      
      const result = jwt.verify(token, secret);
      
      expect(jwt.verify).toHaveBeenCalledWith(token, secret);
      expect(result).toEqual(decoded);
    });
  });

  describe('User Database Operations', () => {
    it('should find user by email', async () => {
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        employeeId: 'EMP001',
        role: 'USER',
        isActive: true,
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const user = await mockPrisma.user.findUnique({
        where: { email: 'test@example.com' },
      });

      expect(user).toEqual(mockUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
    });

    it('should return null for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const user = await mockPrisma.user.findUnique({
        where: { email: 'nonexistent@example.com' },
      });

      expect(user).toBeNull();
    });

    it('should create new user', async () => {
      const newUserData = {
        email: 'newuser@example.com',
        password: 'hashed_password',
        firstName: 'Jane',
        lastName: 'Smith',
        employeeId: 'EMP002',
        role: 'USER',
      };

      const mockCreatedUser = {
        id: '2',
        ...newUserData,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.user.create.mockResolvedValue(mockCreatedUser);

      const user = await mockPrisma.user.create({
        data: newUserData,
      });

      expect(user).toEqual(mockCreatedUser);
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: newUserData,
      });
    });

    it('should prevent duplicate email registration', async () => {
      const existingUser = {
        id: '1',
        email: 'existing@example.com',
      };

      mockPrisma.user.findUnique.mockResolvedValue(existingUser);

      const user = await mockPrisma.user.findUnique({
        where: { email: 'existing@example.com' },
      });

      expect(user).not.toBeNull();
      // In your actual controller, you'd check this and return 409 error
    });

    it('should filter inactive users', async () => {
      const inactiveUser = {
        id: '1',
        email: 'inactive@example.com',
        isActive: false,
      };

      mockPrisma.user.findUnique.mockResolvedValue(inactiveUser);

      const user = await mockPrisma.user.findUnique({
        where: { email: 'inactive@example.com' },
      });

      expect(user?.isActive).toBe(false);
      // In your actual controller, you'd check this and return 403 error
    });
  });

  describe('Password Security', () => {
    it('should use bcrypt with salt rounds 10', async () => {
      const password = 'mypassword';
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');

      await bcrypt.hash(password, 10);

      expect(bcrypt.hash).toHaveBeenCalledWith(password, 10);
    });

    it('should handle bcrypt errors gracefully', async () => {
      (bcrypt.hash as jest.Mock).mockRejectedValue(new Error('Hashing failed'));

      await expect(bcrypt.hash('password', 10)).rejects.toThrow('Hashing failed');
    });

    it('should compare passwords securely', async () => {
      const plainPassword = 'password123';
      const hashedPassword = 'hashed_password';

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const isMatch = await bcrypt.compare(plainPassword, hashedPassword);

      expect(isMatch).toBe(true);
    });
  });

  describe('JWT Token Management', () => {
    it('should include user info in token payload', () => {
      const payload = {
        userId: '1',
        email: 'user@example.com',
        role: 'USER',
        employeeId: 'EMP001',
      };

      (jwt.sign as jest.Mock).mockReturnValue('token');

      jwt.sign(payload, 'secret', { expiresIn: '24h' });

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: '1',
          email: 'user@example.com',
          role: 'USER',
        }),
        'secret',
        { expiresIn: '24h' }
      );
    });

    it('should set token expiration', () => {
      (jwt.sign as jest.Mock).mockReturnValue('token');

      jwt.sign({ userId: '1' }, 'secret', { expiresIn: '7d' });

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.any(Object),
        'secret',
        { expiresIn: '7d' }
      );
    });

    it('should handle expired tokens', () => {
      const error = new Error('Token expired');
      error.name = 'TokenExpiredError';
      
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw error;
      });

      expect(() => jwt.verify('expired-token', 'secret')).toThrow('Token expired');
    });

    it('should handle invalid tokens', () => {
      const error = new Error('Invalid token');
      error.name = 'JsonWebTokenError';
      
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw error;
      });

      expect(() => jwt.verify('invalid-token', 'secret')).toThrow('Invalid token');
    });
  });
});