-- C4: Chống brute-force OTP portal — theo dõi số lần thử sai + thời gian khóa
ALTER TABLE "portal_otps" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "portal_otps" ADD COLUMN IF NOT EXISTS "blockedUntil" TIMESTAMPTZ;
