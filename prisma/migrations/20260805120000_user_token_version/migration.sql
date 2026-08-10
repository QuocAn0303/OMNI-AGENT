-- M1: tokenVersion cho User — vô hiệu hóa mọi access token khi đổi mật khẩu
ALTER TABLE users ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;
