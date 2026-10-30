-- PRM (2026-10) — đưa `partners.type` và `partners.commissionType` từ TEXT sang ENUM
--
-- VÌ SAO CẦN MIGRATION NÀY
-- Migration `20261008120000_prm_partner_referral` tạo hai cột trên dưới dạng
-- `TEXT NOT NULL DEFAULT 'AFFILIATE'` / `'PERCENT_OF_CLV'`, trong khi `prisma/schema.prisma`
-- khai báo chúng bằng enum `PartnerType` và `CommissionType`.
--
-- Hệ quả là Prisma Client (được sinh TỪ schema) khi truy vấn sẽ gửi tham số với
-- kiểu `"PartnerType"`, còn Postgres thấy cột là `text` và báo:
--     type "public.PartnerType" does not exist
-- Nghĩa là MỌI truy vấn vào bảng `partners` đều hỏng — kể cả `findFirst`. Đây không
-- phải lỗi hiển thị mà là lỗi runtime, và nó chỉ lộ ra khi có truy vấn thật.
--
-- VÌ SAO `verify-migration.js` ban đầu không bắt được
-- Bản kiểm tra cũ chỉ hỏi "cột có tồn tại không", "index có không", "khoá ngoại có
-- không" — không hỏi CỘT ĐANG CÓ KIỂU GÌ. Tồn tại nhưng sai kiểu vẫn là hỏng.
-- `verify-migration.js` đã được bổ sung mục kiểu cột để không lặp lại.
--
-- AN TOÀN
--   - ADDITIVE về hình dạng, không xoá bảng, không xoá cột.
--   - Trước khi đổi kiểu, kiểm tra không có giá trị nào nằm ngoài tập enum. Có thì
--     migration DỪNG lại và in ra giá trị lạ, thay vì âm thầm đổi kiểu và làm hỏng
--     truy vấn — thà báo lỗi rõ còn hơn hỏng âm thầm.

-- ---------------------------------------------------------------------------
-- 1. Tạo kiểu enum (nếu chưa có)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerType') THEN
        CREATE TYPE "PartnerType" AS ENUM ('AFFILIATE', 'MARKETING_CHANNEL', 'REFERRER', 'SALES_AGENT');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionType') THEN
        CREATE TYPE "CommissionType" AS ENUM ('PERCENT_OF_CLV', 'FIXED_PER_CUSTOMER');
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Chặn trước nếu có giá trị lạ
-- ---------------------------------------------------------------------------
-- LƯU Ý: mọi tên cột dạng camelCase phải NHẤN DẤU NHÁY trong khối plpgsql này.
-- Postgres hạ chữ thường mã định danh không nhấn, nên `commissionType` sẽ thành
-- `commissiontype` và báo "column does not exist". Đây là bẫy rất dễ dính.
DO $$
DECLARE
    bad_type       TEXT;
    bad_commission TEXT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM partners
        WHERE "commissionType" IS NOT NULL
          AND "commissionType" NOT IN ('PERCENT_OF_CLV', 'FIXED_PER_CUSTOMER')
    ) THEN
        SELECT string_agg(DISTINCT "commissionType", ', ') INTO bad_commission FROM partners
        WHERE "commissionType" NOT IN ('PERCENT_OF_CLV', 'FIXED_PER_CUSTOMER');
        RAISE EXCEPTION
            'partners.commissionType có giá trị ngoài enum CommissionType: % — sửa dữ liệu trước rồi chạy lại', bad_commission;
    END IF;

    IF EXISTS (
        SELECT 1 FROM partners
        WHERE "type" IS NOT NULL
          AND "type" NOT IN ('AFFILIATE', 'MARKETING_CHANNEL', 'REFERRER', 'SALES_AGENT')
    ) THEN
        SELECT string_agg(DISTINCT "type", ', ') INTO bad_type FROM partners
        WHERE "type" NOT IN ('AFFILIATE', 'MARKETING_CHANNEL', 'REFERRER', 'SALES_AGENT');
        RAISE EXCEPTION
            'partners.type có giá trị ngoài enum PartnerType: % — sửa dữ liệu trước rồi chạy lại', bad_type;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Đổi kiểu cột
-- ---------------------------------------------------------------------------
-- Phải BỎ DEFAULT trước, đổi kiểu, rồi GẮN LẠI. Postgres không tự ép kiểu cho giá
-- trị mặc định: `DEFAULT 'AFFILIATE'` là hằng kiểu `unknown`, ép sang enum sẽ báo
-- "default for column cannot be cast automatically to type PartnerType".
ALTER TABLE "partners"
    ALTER COLUMN "type" DROP DEFAULT,
    ALTER COLUMN "commissionType" DROP DEFAULT;

-- `USING ...::Enum` là bắt buộc: Postgres không tự chuyển TEXT sang enum.
ALTER TABLE "partners"
    ALTER COLUMN "type" TYPE "PartnerType" USING "type"::"PartnerType",
    ALTER COLUMN "commissionType" TYPE "CommissionType" USING "commissionType"::"CommissionType";

-- Gắn lại mặc định, lần này ép kiểu tường minh cho chắc.
ALTER TABLE "partners"
    ALTER COLUMN "type" SET DEFAULT 'AFFILIATE'::"PartnerType",
    ALTER COLUMN "commissionType" SET DEFAULT 'PERCENT_OF_CLV'::"CommissionType";

-- ---------------------------------------------------------------------------
-- 4. Ghi chú lại trong DB
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN "partners"."type" IS
    'Loại đối tác. Kiểu enum PartnerType, KHỚP với prisma/schema.prisma.';
COMMENT ON COLUMN "partners"."commissionType" IS
    'Cách tính hoa hồng. Kiểu enum CommissionType, KHỚP với prisma/schema.prisma.';