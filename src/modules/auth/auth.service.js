/**
 * modules/auth/auth.service.js — Business logic xác thực người dùng
 * 
 * Tổng quan:
 * - Quản lý vòng đời JWT access token + refresh token
 * - Refresh token lưu trong DB (bảng RefreshToken), có rotate (cũ revoked, mới tạo)
 * - Password luôn hash bằng bcrypt (salt rounds = 10), không bao giờ lưu plain text
 * - Audit log cho mọi sự kiện: LOGIN, CHANGE_PASSWORD, REGISTER, VERIFY_EMAIL
 * - Hỗ trợ đăng ký tenant mới: tạo tenant + user ADMIN + companySettings + gói FREE trial
 * 
 * Hàm:
 * - login({ email, password }): Xác thực → tạo JWT + refresh token → trả { token, refreshToken, user }
 * - getProfile(userId): Lấy thông tin user (không password)
 * - changePassword(userId, { currentPassword, newPassword }): Xác thực mật khẩu cũ → hash mới → update
 * - createAccessToken(user): Tạo JWT từ user object (dùng nội bộ)
 * - refreshAccessToken(providedToken): Kiểm tra refresh token → rotate → trả cặp mới
 * - revokeRefreshToken({ token, userId, revokeAll }): Thu hồi 1 hoặc tất cả refresh token
 * - register({ companyName, email, password, industry, fullName }): Tạo tenant + user + companySettings + subscription trial free
 * - verifyEmail(token): Xác minh email từ link
 * - generateEmailVerifyToken(): Sinh token ngẫu nhiên 32 bytes hex
 * - buildVerifyLink(token): Tạo URL xác minh
 */

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const { sendEmail } = require("../../utils/email");

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

  // 4. Check email verified (only for non-super users)
  if (!user.emailVerified && user.emailVerifyToken && user.role !== 'SUPER_OMEGA_ULTRA_ADMIN') {
    throw { status: 403, message: 'Vui lòng xác minh email trước khi đăng nhập' };
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

const generateEmailVerifyToken = () => {
  return crypto.randomBytes(32).toString('hex')
}

const buildVerifyLink = (token) => {
  const baseUrl = process.env.CLIENT_URL || 'http://localhost:5173'
  return `${baseUrl}/verify-email?token=${token}`
}

const register = async ({ companyName, email, password, industry, fullName }) => {
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
  const verifyToken = generateEmailVerifyToken()
  const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h

  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { name: companyName, slug },
    })

    const user = await tx.user.create({
      data: {
        email,
        password: hashedPassword,
        fullName: fullName || companyName,
        role: 'ADMIN',
        tenantId: tenant.id,
        emailVerified: false,
        emailVerifyToken: verifyToken,
        emailVerifyExpiry: verifyExpiry,
        registrationStatus: 'PENDING',
      },
    })

    await tx.companySettings.create({
      data: { name: companyName, industry },
    })

    const freePlan = await tx.subscriptionPlan.findUnique({ where: { key: 'free' } })
    if (freePlan) {
      const endDate = new Date()
      endDate.setDate(endDate.getDate() + freePlan.durationDays)
      await tx.tenantSubscription.create({
        data: {
          tenantId: tenant.id,
          planId: freePlan.id,
          status: 'TRIAL',
          startDate: new Date(),
          endDate,
        },
      })
    }

    return { tenant, user }
  })

  const verifyLink = buildVerifyLink(verifyToken)

  const recipientName = fullName || companyName;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
    <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
      <tr><td style="background:#0d9488;padding:32px;text-align:center;color:#fff;font-size:20px;font-weight:700">
        Xác minh tài khoản Aduu ERP
      </td></tr>
      <tr><td style="padding:32px">
        <p style="font-size:15px;color:#1e293b">Xin chào <strong>${recipientName}</strong>,</p>
        <p style="font-size:14px;color:#475569;line-height:1.6">
          Cảm ơn bạn đã đăng ký tài khoản Aduu ERP. Vui lòng nhấn nút bên dưới để xác minh địa chỉ email và kích hoạt tài khoản của bạn.
        </p>
        <div style="text-align:center;margin:28px 0">
          <a href="${verifyLink}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
            Xác minh tài khoản
          </a>
        </div>
        <p style="font-size:13px;color:#64748b">
          Hoặc copy đường dẫn này vào trình duyệt:<br>
          <span style="color:#0d9488;word-break:break-all">${verifyLink}</span>
        </p>
        <p style="font-size:13px;color:#64748b;margin-top:24px">
          Liên kết có hiệu lực trong 24 giờ. Nếu bạn không yêu cầu đăng ký, vui lòng bỏ qua email này.
        </p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:16px 32px;text-align:center;font-size:12px;color:#94a3b8">
        Aduu ERP &copy; ${new Date().getFullYear()} — v.2.0
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>`;

  const emailResult = await sendEmail({
    to: email,
    subject: `Xác minh tài khoản Aduu ERP — ${recipientName}`,
    html,
  });

  if (emailResult.mock) {
    console.log(`[DEV] SMTP chưa cấu hình, verify link cho ${email}: ${verifyLink}`);
  }

  auditService.log({
    userId: result.user.id,
    action: 'REGISTER',
    entity: 'Tenant',
    entityId: result.tenant.id,
    after: { companyName, email, plan: 'free', emailVerified: false },
  })

  return { message: 'Vui lòng kiểm tra email để xác minh tài khoản' }
}

const verifyEmail = async (token) => {
  const user = await prisma.user.findFirst({
    where: { emailVerifyToken: token, emailVerified: false },
  })

  if (!user) throw { status: 400, message: 'Token xác minh không hợp lệ hoặc đã hết hạn' }
  if (user.emailVerifyExpiry && new Date(user.emailVerifyExpiry) < new Date()) {
    throw { status: 400, message: 'Token xác minh đã hết hạn' }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerifyToken: null,
      emailVerifyExpiry: null,
      registrationStatus: 'ACTIVE',
    },
  })

  auditService.log({
    userId: user.id,
    action: 'VERIFY_EMAIL',
    entity: 'User',
    entityId: user.id,
    after: { email: user.email, emailVerified: true },
  })

  return { message: 'Email đã được xác minh thành công' }
}

module.exports = {
  login,
  register,
  verifyEmail,
  getProfile,
  changePassword,
  refreshAccessToken,
  revokeRefreshToken,
};
