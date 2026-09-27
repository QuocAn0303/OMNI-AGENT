/**
 * tests/auth.token-expiry.test.js — Access token TTL theo đặc tả §3.1
 *
 * Đặc tả: "JWT Bearer token (access 15p + refresh 7d)".
 * Test:
 * - JWT_EXPIRES_IN='15m' (tests/setup.js) → access token exp - iat = 900s.
 * - Không set env → fallback mặc định 15m (không còn 1h).
 * - Env tùy chỉnh vẫn được tôn trọng.
 */
jest.mock("../src/config/prisma", () => ({
  user: { findUnique: jest.fn() },
  refreshToken: { create: jest.fn() },
}));
jest.mock("../src/utils/email", () => ({ sendEmail: jest.fn() }));
jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn() }));
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const jwt = require("jsonwebtoken");
const prisma = require("../src/config/prisma");
const authService = require("../src/modules/auth/auth.service");

const mockUser = {
  id: "u1", email: "admin@erp.com", fullName: "Admin", role: "ADMIN", tenantId: "t1",
  isActive: true, twoFactorEnabled: false, mustChangePassword: false,
  createdAt: new Date(), updatedAt: new Date(),
  password: "$2b$10$hash", twoFactorSecret: null, tokenVersion: 0,
};

const ttlOf = (token) => {
  const decoded = jwt.decode(token);
  return decoded.exp - decoded.iat;
};

describe("auth.service — access token 15 phút (đặc tả §3.1)", () => {
  const originalEnv = process.env.JWT_EXPIRES_IN;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.refreshToken.create.mockResolvedValue({});
  });

  afterAll(() => {
    if (originalEnv === undefined) delete process.env.JWT_EXPIRES_IN;
    else process.env.JWT_EXPIRES_IN = originalEnv;
  });

  test("JWT_EXPIRES_IN=15m → TTL 900 giây", async () => {
    process.env.JWT_EXPIRES_IN = "15m";
    const { token } = await authService.generateTokens("u1");
    expect(ttlOf(token)).toBe(900);
  });

  test("không set env → mặc định 15m (không phải 1h)", async () => {
    delete process.env.JWT_EXPIRES_IN;
    const { token } = await authService.generateTokens("u1");
    expect(ttlOf(token)).toBe(900);
    expect(ttlOf(token)).not.toBe(3600);
  });

  test("env tùy chỉnh (30m) vẫn được tôn trọng", async () => {
    process.env.JWT_EXPIRES_IN = "30m";
    const { token } = await authService.generateTokens("u1");
    expect(ttlOf(token)).toBe(1800);
  });

  test("refresh token TTL mặc định 7 ngày", async () => {
    process.env.JWT_EXPIRES_IN = "15m";
    await authService.generateTokens("u1");
    const { expiresAt } = prisma.refreshToken.create.mock.calls[0][0].data;
    const days = (new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });
});
