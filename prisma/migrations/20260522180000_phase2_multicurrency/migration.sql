-- Phase 2.4: Multi-currency basics
-- Adds Currency, ExchangeRate tables
-- Adds currency + exchangeRate columns to orders and payments (default VND / 1.0)

CREATE TABLE currencies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(10) UNIQUE NOT NULL,
  name        VARCHAR(100) NOT NULL,
  symbol      VARCHAR(10) NOT NULL,
  "isBase"    BOOLEAN DEFAULT false,
  "isActive"  BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE exchange_rates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "currencyId" UUID NOT NULL REFERENCES currencies(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  rate         NUMERIC(18, 6) NOT NULL,
  source       VARCHAR(50) DEFAULT 'MANUAL',
  "createdAt"  TIMESTAMP DEFAULT NOW(),
  UNIQUE ("currencyId", date)
);

CREATE INDEX idx_exchange_rates_date ON exchange_rates(date DESC);

-- Seed default currencies
INSERT INTO currencies (code, name, symbol, "isBase") VALUES
  ('VND', 'Việt Nam Đồng', '₫', true),
  ('USD', 'US Dollar', '$', false),
  ('EUR', 'Euro', '€', false),
  ('JPY', 'Japanese Yen', '¥', false),
  ('CNY', 'Chinese Yuan', '¥', false),
  ('KRW', 'Korean Won', '₩', false);

-- Seed initial USD rate (approximate)
INSERT INTO exchange_rates ("currencyId", date, rate, source)
SELECT id, CURRENT_DATE, 25300.00, 'SEED'
FROM currencies WHERE code = 'USD';

INSERT INTO exchange_rates ("currencyId", date, rate, source)
SELECT id, CURRENT_DATE, 27500.00, 'SEED'
FROM currencies WHERE code = 'EUR';

INSERT INTO exchange_rates ("currencyId", date, rate, source)
SELECT id, CURRENT_DATE, 165.00, 'SEED'
FROM currencies WHERE code = 'JPY';

INSERT INTO exchange_rates ("currencyId", date, rate, source)
SELECT id, CURRENT_DATE, 3480.00, 'SEED'
FROM currencies WHERE code = 'CNY';

INSERT INTO exchange_rates ("currencyId", date, rate, source)
SELECT id, CURRENT_DATE, 18.00, 'SEED'
FROM currencies WHERE code = 'KRW';

-- Add currency fields to orders (default VND, rate 1)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'VND',
  ADD COLUMN IF NOT EXISTS "exchangeRate" NUMERIC(18, 6) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS "totalVnd" NUMERIC(12, 2) GENERATED ALWAYS AS (total * "exchangeRate") STORED;

-- Add currency fields to payments
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'VND',
  ADD COLUMN IF NOT EXISTS "exchangeRate" NUMERIC(18, 6) NOT NULL DEFAULT 1.0;
