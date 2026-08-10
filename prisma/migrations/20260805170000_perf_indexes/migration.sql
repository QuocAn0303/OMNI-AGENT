-- B1: Composite indexes cho multi-tenant hot paths
-- Tên index theo chuẩn Prisma (<table>_<cols>_idx) để không drift khi migrate dev
-- Tất cả IF NOT EXISTS — an toàn chạy lại

-- Orders: list theo tenant (status/createdAt luôn đi kèm tenantId trong query scope)
CREATE INDEX IF NOT EXISTS "orders_tenantId_createdAt_idx" ON "orders" ("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "orders_tenantId_status_createdAt_idx" ON "orders" ("tenantId", "status", "createdAt");

-- Customers / Products: danh sách tenant + sắp theo ngày
CREATE INDEX IF NOT EXISTS "customers_tenantId_createdAt_idx" ON "customers" ("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "products_tenantId_isActive_createdAt_idx" ON "products" ("tenantId", "isActive", "createdAt");

-- Invoices: dashboard/report theo tenant + ngày
CREATE INDEX IF NOT EXISTS "invoices_tenantId_createdAt_idx" ON "invoices" ("tenantId", "createdAt");

-- Debts: công nợ theo KH/NCC trong tenant (trước đây chỉ có (status, dueDate) không có tenantId prefix)
CREATE INDEX IF NOT EXISTS "debts_tenantId_customerId_idx" ON "debts" ("tenantId", "customerId");
CREATE INDEX IF NOT EXISTS "debts_tenantId_vendorId_idx" ON "debts" ("tenantId", "vendorId");
CREATE INDEX IF NOT EXISTS "debt_payments_debtId_idx" ON "debt_payments" ("debtId");

-- Journal: sổ nhật ký/sổ cái/outbox retry theo tenant + date/status
CREATE INDEX IF NOT EXISTS "journal_entries_tenantId_date_idx" ON "journal_entries" ("tenantId", "date");
CREATE INDEX IF NOT EXISTS "journal_entries_tenantId_status_date_idx" ON "journal_entries" ("tenantId", "status", "date");

-- Audit log: xem lịch sử theo tenant (bảng tăng không kiểm soát — index quan trọng)
CREATE INDEX IF NOT EXISTS "audit_logs_tenantId_createdAt_idx" ON "audit_logs" ("tenantId", "createdAt");

-- Notifications: badge/unread của user và role trong tenant
CREATE INDEX IF NOT EXISTS "notifications_tenantId_userId_isRead_createdAt_idx" ON "notifications" ("tenantId", "userId", "isRead", "createdAt");
CREATE INDEX IF NOT EXISTS "notifications_tenantId_roleScope_isRead_createdAt_idx" ON "notifications" ("tenantId", "roleScope", "isRead", "createdAt");

-- Promotion usage: limit 1 lần/khách hàng + lookup theo đơn
CREATE INDEX IF NOT EXISTS "promotion_usages_promotionId_customerId_idx" ON "promotion_usages" ("promotionId", "customerId");
CREATE INDEX IF NOT EXISTS "promotion_usages_orderId_idx" ON "promotion_usages" ("orderId");

-- Order items / payments: kéo items+payments của đơn trong tenant (điểm nóng POS)
CREATE INDEX IF NOT EXISTS "order_items_tenantId_orderId_idx" ON "order_items" ("tenantId", "orderId");
CREATE INDEX IF NOT EXISTS "payments_tenantId_orderId_idx" ON "payments" ("tenantId", "orderId");

-- Stock transfer: danh sách theo tenant + status
CREATE INDEX IF NOT EXISTS "stock_transfers_tenantId_status_createdAt_idx" ON "stock_transfers" ("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "stock_transfer_items_transferId_idx" ON "stock_transfer_items" ("transferId");
CREATE INDEX IF NOT EXISTS "stock_transfer_items_productId_idx" ON "stock_transfer_items" ("productId");

-- HR: chấm công/vi phạm/OT/lương theo employee + ngày
CREATE INDEX IF NOT EXISTS "shifts_employeeId_date_idx" ON "shifts" ("employeeId", "date");
CREATE INDEX IF NOT EXISTS "violations_employeeId_date_idx" ON "violations" ("employeeId", "date");
CREATE INDEX IF NOT EXISTS "overtime_requests_employeeId_date_idx" ON "overtime_requests" ("employeeId", "date");
CREATE INDEX IF NOT EXISTS "payrolls_employeeId_month_year_idx" ON "payrolls" ("employeeId", "month", "year");

-- Timesheet theo user + thời gian
CREATE INDEX IF NOT EXISTS "time_entries_userId_startTime_idx" ON "time_entries" ("userId", "startTime");

-- Sản xuất: danh sách lệnh theo tenant + status
CREATE INDEX IF NOT EXISTS "work_orders_tenantId_status_createdAt_idx" ON "work_orders" ("tenantId", "status", "createdAt");

-- FK lookup child tables (trước đây chỉ có index tenantId riêng lẻ)
CREATE INDEX IF NOT EXISTS "cycle_count_items_cycleCountId_idx" ON "cycle_count_items" ("cycleCountId");
CREATE INDEX IF NOT EXISTS "return_line_items_returnId_idx" ON "return_line_items" ("returnId");
CREATE INDEX IF NOT EXISTS "delivery_events_deliveryId_idx" ON "delivery_events" ("deliveryId");
CREATE INDEX IF NOT EXISTS "lot_transactions_lotId_idx" ON "lot_transactions" ("lotId");
CREATE INDEX IF NOT EXISTS "lot_transactions_orderId_idx" ON "lot_transactions" ("orderId");
CREATE INDEX IF NOT EXISTS "purchase_items_purchaseOrderId_idx" ON "purchase_items" ("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "routing_operations_routingId_idx" ON "routing_operations" ("routingId");

-- Inventory lots: tra theo sản phẩm + kho
CREATE INDEX IF NOT EXISTS "inventory_lots_productId_warehouseId_idx" ON "inventory_lots" ("productId", "warehouseId");

-- pgvector: HNSW index cho AI RAG similarity search (bảng tạo bằng raw SQL migration
-- 20260620100000_add_ai_vector_tables — không có model trong schema nên không drift)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_embeddings' AND column_name = 'embedding'
      AND data_type = 'USER-DEFINED' AND udt_name = 'vector'
  ) THEN
    CREATE INDEX IF NOT EXISTS "idx_ai_embeddings_hnsw" ON "ai_embeddings"
      USING hnsw ("embedding" vector_cosine_ops);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector HNSW index skipped: %', SQLERRM;
END $$;
