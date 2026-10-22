-- Kiểm tra migration PRM đã tạo đúng cấu trúc chưa.
-- Chạy: npx prisma db execute --file scripts/prm/verify-migration.sql --schema prisma/schema.prisma
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name IN ('partners','partner_referrals')
 ORDER BY table_name;

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='customers'
   AND column_name IN ('partnerReferralId','acquiredCost')
 ORDER BY column_name;

SELECT indexname FROM pg_indexes
 WHERE schemaname='public' AND tablename='partner_referrals'
 ORDER BY indexname;

SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid='partner_referrals'::regclass AND contype='f';