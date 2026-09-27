const prisma = require('../../config/prisma');
const otplib = require('otplib');
const crypto = require('crypto');
const auditService = require('../audit/audit.service');
const { encrypt, decrypt } = require('../../utils/crypto');

const SECRET_KEY = '2FA';

// ─────────────────────────────────────────────────────────────
// 2FA LOCKOUT (chống brute-force OTP/backup code)
// - Theo tài khoản: 5 lần thất bại liên tiếp → khóa 15 phút
// - In-memory (mất khi restart server — chấp nhận được vì vẫn
//   còn lớp password + rate limit IP ở route)
// ─────────────────────────────────────────────────────────────
const MAX_2FA_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const twofaFailures = new Map(); // userId → { count, lockedUntil }

const check2faLockout = (userId) => {
  const rec = twofaFailures.get(userId);
  if (!rec || !rec.lockedUntil) return;
  if (rec.lockedUntil > Date.now()) {
    const mins = Math.ceil((rec.lockedUntil - Date.now()) / 60000);
    throw { status: 429, message: `Quá nhiều lần nhập sai mã 2FA. Vui lòng thử lại sau ${mins} phút.` };
  }
  twofaFailures.delete(userId);
};

const record2faFailure = (userId) => {
  const rec = twofaFailures.get(userId) || { count: 0, lockedUntil: null };
  rec.count += 1;
  if (rec.count >= MAX_2FA_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
    rec.count = 0;
    twofaFailures.set(userId, rec);
    auditService.log({
      userId,
      action: '2FA_LOCKOUT',
      entity: 'User',
      entityId: userId,
      after: { maxAttempts: MAX_2FA_ATTEMPTS, lockMinutes: LOCKOUT_MINUTES },
    });
    throw { status: 429, message: `Quá nhiều lần nhập sai mã 2FA. Tài khoản bị khóa ${LOCKOUT_MINUTES} phút.` };
  }
  twofaFailures.set(userId, rec);
};

const clear2faFailures = (userId) => {
  twofaFailures.delete(userId);
};

const setup2fa = async (userId) => {
  const secret = otplib.generateSecret();
  const service = 'Aduu ERP';
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const otpauth = otplib.generateURI({ issuer: service, label: user.email, secret });

  const enc = encrypt(secret);
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: enc.valueEnc, twoFactorIv: enc.iv },
  });

  return { secret, otpauth };
};

const enable2fa = async (userId, token) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { twoFactorSecret: true, twoFactorIv: true } });
  if (!user.twoFactorSecret) throw { status: 400, message: 'Chưa thiết lập 2FA. Gọi setup trước.' };

  const decrypted = decrypt(user.twoFactorSecret, user.twoFactorIv);
  if (!decrypted) throw { status: 400, message: 'Lỗi giải mã 2FA secret' };

  const isValid = await otplib.verify({ secret: decrypted, token });
  if (!isValid) throw { status: 400, message: 'Mã OTP không hợp lệ' };

  const backupCodes = [];
  for (let i = 0; i < 8; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    backupCodes.push(code);
    await prisma.backupCode.create({
      data: { userId, codeHash },
    });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true },
  });

  auditService.log({ userId, action: 'ENABLE_2FA', entity: 'User', entityId: userId });
  return { backupCodes };
};

const verify2fa = async (userId, token) => {
  check2faLockout(userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorSecret: true, twoFactorIv: true, twoFactorEnabled: true },
  });
  if (!user) return false;
  if (!user.twoFactorEnabled) return true;

  const decrypted = user.twoFactorSecret ? decrypt(user.twoFactorSecret, user.twoFactorIv) : null;
  if (decrypted && await otplib.verify({ secret: decrypted, token })) {
    clear2faFailures(userId);
    return true;
  }

  const codeHash = crypto.createHash('sha256').update(token).digest('hex');
  const backupCode = await prisma.backupCode.findUnique({
    where: { userId_codeHash: { userId, codeHash } },
  });
  if (backupCode && !backupCode.usedAt) {
    await prisma.backupCode.update({
      where: { id: backupCode.id },
      data: { usedAt: new Date() },
    });
    clear2faFailures(userId);
    return true;
  }

  record2faFailure(userId);
  return false;
};

const disable2fa = async (userId) => {
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: null, twoFactorIv: null, twoFactorEnabled: false },
  });
  await prisma.backupCode.deleteMany({ where: { userId } });
  auditService.log({ userId, action: 'DISABLE_2FA', entity: 'User', entityId: userId });
};

module.exports = { setup2fa, enable2fa, verify2fa, disable2fa };
