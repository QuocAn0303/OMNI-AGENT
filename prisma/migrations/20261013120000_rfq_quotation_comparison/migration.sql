-- RFQ / so sánh báo giá nhà cung cấp (Request for Quotation của Odoo).
--
-- VÌ SAO:
-- Trước đây chuỗi mua hàng là `Vendor → PurchaseOrder` thẳng: hệ thống tự chọn
-- NCC từ PO gần nhất rồi tạo PO, KHÔNG có bước hỏi giá và không có bằng chứng
-- vì sao chọn NCC đó. Odoo có `purchase.order` ở trạng thái RFQ và người dùng
-- so sánh báo giá trước khi chốt.
--
-- THIẾT KẾ:
--   Rfq         1 yêu cầu mua (nhiều dòng hàng)
--   RfqItem     1 dòng hàng, dùng chung cho mọi báo giá
--   RfqQuote    1 báo giá của 1 NCC cho RFQ đó   (@@unique [rfqId, vendorId])
--   RfqQuoteLine giá của từng dòng trong báo giá  (@@unique [quoteId, rfqItemId])
--
-- GHI CHÚ VỀ KHOÁ:
--   `awardedVendorId` và `purchaseOrderId` CỐ Ý KHÔNG có khoá ngoại tới
--   `vendors`/`purchase_orders`. Lý do: giữ được lịch sử quyết định khi NCC bị
--   xoá mềm (`isActive = false`) — cùng nguyên tắc với `PartnerReferral.customerId`
--   và `PurchaseItem.productId`. Xoá mất chứng cứ chọn nhà cung cấp thì tệ hơn là
--   mất một dòng tham chiếu.

CREATE TYPE "RfqStatus" AS ENUM ('OPEN', 'AWARDED', 'CANCELLED');
CREATE TYPE "RfqQuoteStatus" AS ENUM ('PENDING', 'QUOTED', 'DECLINED', 'SELECTED');

CREATE TABLE "rfqs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "rfqCode" TEXT NOT NULL,
    "status" "RfqStatus" NOT NULL DEFAULT 'OPEN',
    "deadlineAt" TIMESTAMP(3),
    "note" TEXT,
    "awardedVendorId" TEXT,
    "awardedAt" TIMESTAMP(3),
    "awardedById" TEXT,
    "purchaseOrderId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfqs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rfq_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "rfqId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rfq_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rfq_quotes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "rfqId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "RfqQuoteStatus" NOT NULL DEFAULT 'PENDING',
    "promisedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfq_quotes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rfq_quote_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "quoteId" TEXT NOT NULL,
    "rfqItemId" TEXT NOT NULL,
    "unitCost" DECIMAL(15,2) NOT NULL,
    "availableQty" INTEGER,

    CONSTRAINT "rfq_quote_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rfqs_rfqCode_key" ON "rfqs"("rfqCode");
CREATE UNIQUE INDEX "rfqs_purchaseOrderId_key" ON "rfqs"("purchaseOrderId");
CREATE INDEX "rfqs_tenantId_status_idx" ON "rfqs"("tenantId", "status");

CREATE INDEX "rfq_items_rfqId_idx" ON "rfq_items"("rfqId");

CREATE UNIQUE INDEX "rfq_quotes_rfqId_vendorId_key" ON "rfq_quotes"("rfqId", "vendorId");
CREATE INDEX "rfq_quotes_tenantId_idx" ON "rfq_quotes"("tenantId");

CREATE UNIQUE INDEX "rfq_quote_lines_quoteId_rfqItemId_key" ON "rfq_quote_lines"("quoteId", "rfqItemId");
CREATE INDEX "rfq_quote_lines_rfqItemId_idx" ON "rfq_quote_lines"("rfqItemId");

ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_rfqId_fkey"
    FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "rfq_quotes" ADD CONSTRAINT "rfq_quotes_rfqId_fkey"
    FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rfq_quotes" ADD CONSTRAINT "rfq_quotes_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rfq_quote_lines" ADD CONSTRAINT "rfq_quote_lines_quoteId_fkey"
    FOREIGN KEY ("quoteId") REFERENCES "rfq_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rfq_quote_lines" ADD CONSTRAINT "rfq_quote_lines_rfqItemId_fkey"
    FOREIGN KEY ("rfqItemId") REFERENCES "rfq_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_awardedById_fkey"
    FOREIGN KEY ("awardedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Giá báo giá phải > 0: giá 0 hoặc âm là dữ liệu rác, và khi chốt PO sẽ tạo
-- PO với giá vốn 0 ⇒ `classifyUnitCost` báo MISSING_COST và chặn duyệt.
ALTER TABLE "rfq_quote_lines"
    ADD CONSTRAINT "rfq_quote_lines_unitCost_positive" CHECK ("unitCost" > 0);

-- Số lượng cần mua phải > 0, nếu không thành phẩm bằng 0 và cả bảng so sánh vô nghĩa.
ALTER TABLE "rfq_items"
    ADD CONSTRAINT "rfq_items_quantity_positive" CHECK ("quantity" > 0);

-- RFQ đã chốt thì không được mở lại nhiều lần chọn NCC khác nhau.
ALTER TABLE "rfqs"
    ADD CONSTRAINT "rfqs_award_consistent" CHECK (
        ("status" = 'AWARDED' AND "awardedVendorId" IS NOT NULL)
        OR ("status" <> 'AWARDED' AND "awardedVendorId" IS NULL)
    );