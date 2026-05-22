-- Thêm indexes cho high-traffic queries.
-- Idempotent (IF NOT EXISTS) để chạy lại không lỗi.

-- InventoryTransaction: lịch sử giao dịch theo inventory, sort desc
CREATE INDEX IF NOT EXISTS "inventory_transactions_inventoryId_createdAt_idx"
  ON "inventory_transactions" ("inventoryId", "createdAt" DESC);

-- AuditLog: liệt kê theo thời gian (admin) + filter theo user
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx"
  ON "audit_logs" ("createdAt" DESC);

CREATE INDEX IF NOT EXISTS "audit_logs_userId_createdAt_idx"
  ON "audit_logs" ("userId", "createdAt" DESC);

-- Order: dashboard filter status + sort by createdAt
CREATE INDEX IF NOT EXISTS "orders_status_createdAt_idx"
  ON "orders" ("status", "createdAt" DESC);

-- Notification: debounce check theo type + thời gian
CREATE INDEX IF NOT EXISTS "notifications_type_createdAt_idx"
  ON "notifications" ("type", "createdAt" DESC);

-- Payment: lịch sử payment của order
CREATE INDEX IF NOT EXISTS "payments_orderId_createdAt_idx"
  ON "payments" ("orderId", "createdAt" DESC);
