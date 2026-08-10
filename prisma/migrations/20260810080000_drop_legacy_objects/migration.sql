-- Dọn bảng/enum legacy còn sót từ db push cũ (không có model/code sử dụng):
--   happy_hour_rules, payment_transactions, PaymentProvider, PaymentTxStatus
-- Cả 2 bảng đều rỗng (verify trước khi drop).
DROP TABLE IF EXISTS happy_hour_rules;
DROP TABLE IF EXISTS payment_transactions;
DROP TYPE IF EXISTS "PaymentProvider";
DROP TYPE IF EXISTS "PaymentTxStatus";
