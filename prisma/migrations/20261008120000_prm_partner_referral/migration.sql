-- PRM (2026-10) — bảng `partners` và `partner_referrals` + hai cột PRM trên `customers`.
--
-- VÌ SAO CẦN BẢNG NÀY
-- Trước đồ nguồn khách chỉ nằm ở `customers.referralSource`, một `String?` tự do
-- (ví dụ "Affiliate_Partner_01", xem `tests/webhook-lead.route.test.js`). Hệ thống
-- đo được "có bao nhiêu khách theo nguồn" nhưng KHÔNG đo được:
--   - khách nào do đối tác nào giới thiệu;
--   - đối tác nào mang lại khách chất lượng (CLV cao) chứ không chỉ nhiều lượt;
--   - hoa hồng phải trả cho từng đối tác;
--   - phễu chuyển đổi lượt giới thiệu theo từng đối tác.
-- Đề cương đồ án EC213 yêu cầu đúng ba ý cuối. Xem `docs/PLAN_PRM_partner_module.md`.
--
-- KHÁC `vendors` THẾ NÀO
-- `vendors` là NHÀ CUNG CẤP đầu vào (phía SRM): mua hàng, Kraljic, OTIF, 3-way
-- matching. `partners` là ĐỐI TÁC đầu ra (phía PRM): giới thiệu khách, hoa hồng,
-- ROI. Hai chiều của quan hệ, không thay thế nhau.
--
-- AN TOÀN
--   - ADDITIVE thuần: chỉ CREATE TABLE IF NOT EXISTS + CREATE INDEX +
--     ADD COLUMN IF NOT EXISTS. Không ALTER/DROP bảng đang có, không chạm dữ liệu.
--   - `tenantId` KHÔNG có khoá ngoại tới `tenants` (giống `churn_alerts` và
--     `llm_usage_logs`): còn ghi được dòng NULL cho lần gọi ngoài tenant context
--     (cron/script) — cần để phân biệt "lỗi" với "không thuộc tenant nào".
--   - KHÔNG dùng `prisma migrate dev`: repo có bảng RAG vector
--     (`prisma/migrations/20260620100000_add_ai_vector_tables`) nên `migrate dev`
--     có thể sinh ALTER cột `real[]`/`vector`. Dùng `migrate deploy`.
--   - `partner_referrals.customerId` / `leadId` cố tình KHÔNG có khoá ngoại (xem
--     giải thích dài trong `prisma/schema.prisma`): lượt giới thiệu là chứng từ
--     kinh doanh, không được mất khi khách bị xoá mền.

-- CreateTable
CREATE TABLE IF NOT EXISTS "partners" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'AFFILIATE',
    "commissionType" TEXT NOT NULL DEFAULT 'PERCENT_OF_CLV',
    "commissionRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fixedCommission" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "partner_referrals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "partnerId" TEXT NOT NULL,
    "leadId" TEXT,
    "customerId" TEXT,
    "referralCode" TEXT NOT NULL,
    "referredName" TEXT NOT NULL,
    "referredPhone" TEXT,
    "referredEmail" TEXT,
    "referralDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "convertedAt" TIMESTAMP(3),
    "sourceSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_referrals_pkey" PRIMARY KEY ("id")
);

-- AlterTable: hai cột PRM trên `customers`.
--
-- `partnerReferralId` là khoá MỀM, không khai báo ràng buộc khoá ngoại (xem giải
-- thích trong schema). `acquiredCost` cho phép NULL vì phần lớn khách đến tự nhiên.
--
-- Dùng ADD COLUMN IF NOT EXISTS để chạy lại trên cơ sở dữ liệu đã có cột cũng
-- không lỗi (nhiều tenant dùng chung một PostgreSQL).
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "partnerReferralId" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "acquiredCost" DECIMAL(15,2);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "partners_code_tenantId_key" ON "partners"("code", "tenantId");
CREATE INDEX IF NOT EXISTS "partners_tenantId_isActive_idx" ON "partners"("tenantId", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "partner_referrals_referralCode_key" ON "partner_referrals"("referralCode");
CREATE UNIQUE INDEX IF NOT EXISTS "partner_referrals_partnerId_referredPhone_key" ON "partner_referrals"("partnerId", "referredPhone");
CREATE INDEX IF NOT EXISTS "partner_referrals_tenantId_partnerId_idx" ON "partner_referrals"("tenantId", "partnerId");
CREATE INDEX IF NOT EXISTS "partner_referrals_tenantId_converted_idx" ON "partner_referrals"("tenantId", "converted");

-- AddForeignKey
--
-- CHỈ có khoá ngoại cho `partnerId`: quan hệ này là dữ liệu đang giao dịch, cần
-- toàn vẹn ở tầng cơ sở dữ liệu (không thể có lượt giới thiệu mà không có đối tác).
-- Ngược lại `customerId`/`leadId` cố tình không có — xem giải thích ở trên.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'partner_referrals_partnerId_fkey'
    ) THEN
        ALTER TABLE "partner_referrals"
            ADD CONSTRAINT "partner_referrals_partnerId_fkey"
            FOREIGN KEY ("partnerId") REFERENCES "partners"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;