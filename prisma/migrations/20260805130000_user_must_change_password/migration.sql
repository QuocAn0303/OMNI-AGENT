-- L3 + L6: force đổi mật khẩu mặc định + chặn bypass email verify
-- 1. User cần đổi mật khẩu ngay lần đăng nhập đầu (admin seed mặc định)
ALTER TABLE users ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- 2. User tạo bởi admin (không có luồng verify email) → xem như admin đã chứng thực:
--    emailVerified = true (nếu không, login mới (L6) sẽ khóa họ vì không có token verify)
UPDATE users
  SET "emailVerified" = true, "registrationStatus" = 'ACTIVE'
  WHERE "emailVerified" = false
    AND "emailVerifyToken" IS NULL
    AND "emailVerifyExpiry" IS NULL;
