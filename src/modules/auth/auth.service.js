// src/modules/auth/auth.service.js
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");

// Ghi chú: Phần refresh token + logout
// - Refresh token được lưu vào bảng `RefreshToken` (Prisma schema)
// - Khi login sẽ tạo 1 refresh token và trả về cùng access token
// - Endpoint refresh sẽ kiểm tra token, revoke token cũ và tạo token mới (rotate)
// - Logout sẽ revoke refresh token (hoặc revoke tất cả token của user nếu muốn)

// ─────────────────────────────────────────────────────────────
// LOGIN
// Nhận vào { email, password }
// Trả về   { token, user }
// ─────────────────────────────────────────────────────────────
const login = async ({ email, password }) => {
  // 1. Tìm user theo email trong database
  const user = await prisma.user.findUnique({
    where: { email },
  });

  // 2. Không tìm thấy → báo lỗi chung (không nói rõ email sai hay pass sai)
  //    Mục đích: tránh hacker biết email nào tồn tại trong hệ thống
  if (!user) {
    throw { status: 401, message: "Email hoặc mật khẩu không đúng" };
  }

  // 3. Tài khoản bị vô hiệu hóa (isActive = false)
  if (!user.isActive) {
    throw { status: 403, message: "Tài khoản đã bị vô hiệu hóa" };
  }

  if (!user) {
    throw { status: 404, message: "Không tìm thấy người dùng" };
  }

  // 4. So sánh password người dùng nhập với hash trong database
  //    bcrypt.compare(plainText, hash) → trả true nếu khớp, false nếu không
  //    KHÔNG BAO GIỜ lưu password thẳng vào DB — luôn lưu hash
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw { status: 401, message: "Email hoặc mật khẩu không đúng" };
  }

  // 5. Tạo JWT token
  //    Payload = dữ liệu được mã hóa trong token — middleware sẽ decode sau
  //    Chỉ put những gì cần thiết vào payload, KHÔNG put password
  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId || null,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
  );

  // 6. Tạo refresh token và lưu vào database
  const createRefreshToken = async (userId) => {
    const tokenStr = crypto.randomBytes(48).toString("hex");
    const days = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS) || 30;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: { token: tokenStr, userId, expiresAt },
    });
    return tokenStr;
  };

  const refreshToken = await createRefreshToken(user.id);

  // 7. Trả về token + refreshToken + user info
  //    Destructure để bỏ field password ra khỏi object trước khi trả về FE
  const { password: _removed, ...userWithoutPassword } = user;

  // Ghi audit: ai đăng nhập, lúc nào
  auditService.log({
    userId: user.id,
    action: "LOGIN",
    entity: "User",
    entityId: user.id,
    after: { email: user.email, role: user.role },
  });

  return { token, refreshToken, user: userWithoutPassword };
};

// ─────────────────────────────────────────────────────────────
// GET PROFILE
// Dùng khi FE gọi GET /api/auth/me — lấy thông tin user đang đăng nhập
// userId lấy từ req.user.id (do middleware authenticate gắn vào)
// ─────────────────────────────────────────────────────────────
const getProfile = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      createdAt: true,
      tenantId: true,
    },
  });

  if (!user) {
    throw { status: 404, message: "Không tìm thấy người dùng" };
  }

  return user;
};

// ─────────────────────────────────────────────────────────────
// CHANGE PASSWORD
// ─────────────────────────────────────────────────────────────
const changePassword = async (userId, { currentPassword, newPassword }) => {
  // 1. Lấy user — cần lấy cả password hash để verify
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw { status: 404, message: "Không tìm thấy người dùng" };
  }

  // 2. Kiểm tra mật khẩu hiện tại có đúng không
  const isValid = await bcrypt.compare(currentPassword, user.password);
  if (!isValid) {
    throw { status: 400, message: "Mật khẩu hiện tại không đúng" };
  }

  if (currentPassword === newPassword) {
    throw { status: 400, message: "Mật khẩu mới phải khác mật khẩu hiện tại" };
  }

  // 3. Hash mật khẩu mới trước khi lưu
  //    Số 10 = salt rounds — càng cao càng an toàn nhưng càng chậm
  const hashedNewPassword = await bcrypt.hash(
    newPassword,
    Number(process.env.BCRYPT_ROUNDS) || 10,
  );

  // 4. Cập nhật vào database
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedNewPassword },
  });

  // Ghi audit: ai đổi mật khẩu
  auditService.log({
    userId,
    action: "CHANGE_PASSWORD",
    entity: "User",
    entityId: userId,
  });

  return { message: "Đổi mật khẩu thành công" };
};

// Tạo access token từ user object (tách để tái sử dụng)
const createAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId || null },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    },
  );
};

// Dùng khi client gửi refresh token để lấy access token mới
const refreshAccessToken = async (providedToken) => {
  if (!providedToken) throw { status: 401, message: "Thiếu refresh token" };

  const stored = await prisma.refreshToken.findUnique({
    where: { token: providedToken },
  });
  if (!stored || stored.isRevoked)
    throw { status: 401, message: "Refresh token không hợp lệ" };
  if (new Date(stored.expiresAt) < new Date())
    throw { status: 401, message: "Refresh token đã hết hạn" };

  const user = await prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user || !user.isActive)
    throw { status: 401, message: "Tài khoản không hợp lệ" };

  // Revoke old token and create a new one (rotation)
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { isRevoked: true },
  });
  const newRefresh = crypto.randomBytes(48).toString("hex");
  const days = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS) || 30;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { token: newRefresh, userId: user.id, expiresAt },
  });

  const newAccess = createAccessToken(user);
  const { password: _p, ...userWithoutPassword } = user;
  return {
    token: newAccess,
    refreshToken: newRefresh,
    user: userWithoutPassword,
  };
};

// Revoke a refresh token or revoke all tokens for a user
const revokeRefreshToken = async ({ token, userId, revokeAll = false }) => {
  if (revokeAll && userId) {
    await prisma.refreshToken.updateMany({
      where: { userId },
      data: { isRevoked: true },
    });
    return;
  }
  if (token) {
    await prisma.refreshToken.updateMany({
      where: { token },
      data: { isRevoked: true },
    });
    return;
  }
  throw { status: 400, message: "Yêu cầu token hoặc userId để revoke" };
};

const register = async ({ companyName, email, password, industry }) => {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) throw { status: 400, message: 'Email đã được sử dụng' }

  const slug = companyName
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const existingSlug = await prisma.tenant.findUnique({ where: { slug } })
  if (existingSlug) throw { status: 400, message: 'Tên công ty đã tồn tại' }

  const hashedPassword = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS) || 10)

  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { name: companyName, slug, plan: 'free' },
    })

    const user = await tx.user.create({
      data: {
        email,
        password: hashedPassword,
        fullName: companyName,
        role: 'ADMIN',
        tenantId: tenant.id,
      },
    })

    await tx.companySettings.create({
      data: { name: companyName, industry },
    })

    return { tenant, user }
  })

  const token = createAccessToken(result.user)
  const { password: _p, ...userWithoutPassword } = result.user

  auditService.log({
    userId: result.user.id,
    action: 'REGISTER',
    entity: 'Tenant',
    entityId: result.tenant.id,
    after: { companyName, email, plan: 'free' },
  })

  return { token, user: userWithoutPassword, tenant: result.tenant }
}

module.exports = {
  login,
  register,
  getProfile,
  changePassword,
  refreshAccessToken,
  revokeRefreshToken,
};
