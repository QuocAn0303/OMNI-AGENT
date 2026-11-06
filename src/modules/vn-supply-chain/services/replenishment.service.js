'use strict';
const { z } = require('zod');
const nonnegative = z.number().finite().nonnegative().max(1000000000);
const eoqSchema = z.object({ annualDemand: nonnegative, orderingCost: nonnegative.positive(),
  holdingCostPerUnitPerYear: nonnegative.positive(), moq: z.number().int().positive().max(1000000).default(1) }).strict();
function calculateEOQ(input) {
  const { annualDemand, orderingCost, holdingCostPerUnitPerYear, moq } = eoqSchema.parse(input);
  const rawEOQ = Math.sqrt(2 * annualDemand * orderingCost / holdingCostPerUnitPerYear);
  const orderQty = annualDemand === 0 ? 0 : Math.ceil(rawEOQ / moq) * moq;
  if (!Number.isFinite(rawEOQ) || !Number.isSafeInteger(orderQty)) throw new RangeError('EOQ vượt giới hạn số nguyên an toàn');
  return { rawEOQ, orderQty, moq, currency: 'VNĐ' };
}
function calculateROP(input) {
  const { dailyDemand, leadTimeDays, safetyStock } = z.object({
    dailyDemand: nonnegative, leadTimeDays: nonnegative, safetyStock: nonnegative.default(0),
  }).strict().parse(input);
  const rop = Math.ceil(dailyDemand * leadTimeDays + safetyStock);
  if (!Number.isSafeInteger(rop)) throw new RangeError('ROP vượt giới hạn số nguyên an toàn');
  return rop;
}
const planningSchema = z.object({ orderingCost: nonnegative.positive().default(200000),
  safetyStockDays: z.number().finite().min(0).max(60).default(3),
  reviewDays: z.number().int().min(1).max(365).default(7),
  procurementMode: z.enum(['PURCHASE', 'SUBCONTRACT']).default('PURCHASE'),
}).strict();
module.exports = { calculateEOQ, calculateROP, planningSchema };
