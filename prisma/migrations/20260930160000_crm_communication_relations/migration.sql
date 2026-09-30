-- CRM Sales Pipeline Phase 2: khai báo relation cho crm_communications
--
-- Phase 1 đã tạo bảng `crm_communications` với cột leadId/dealId/contactId nhưng
-- chưa gắn FOREIGN KEY (các model khác đều có FK). Phase 2 cần select kèm
-- lead/deal/contact để timeline hiển thị tên → bắt buộc có quan hệ ở tầng DB.
--
-- CHỈ thêm ràng buộc, KHÔNG đụng cột: 3 cột đã tồn tại từ migration
-- 20260930150000_add_crm_sales_pipeline.
--
-- Cố ý KHÔNG kèm `CREATE UNIQUE INDEX currencies_code_key`: đó là drift có sẵn
-- của bảng `currencies` (DB thật không có unique index) — xem mục 3b của
-- docs/CRM_SALES_PIPELINE_PLAN.md, cần migration riêng sau khi kiểm tra dữ liệu trùng.

-- AddForeignKey
ALTER TABLE "crm_communications" ADD CONSTRAINT "crm_communications_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_communications" ADD CONSTRAINT "crm_communications_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "crm_deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_communications" ADD CONSTRAINT "crm_communications_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
