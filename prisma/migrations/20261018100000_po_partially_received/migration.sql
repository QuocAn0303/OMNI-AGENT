-- Chuan P2P: PO nhan tung dot qua GRN.
-- Them PARTIALLY_RECEIVED vao enum PurchaseStatus (Postgres enum them value an toan).
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_RECEIVED';
