'use strict';
const { z } = require('zod');
const identity = { warehouseId: z.string().min(1), sku: z.string().min(1) };
const number = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const signalSchema = z.object({ ...identity, atpQty: number, inTransitQty: number, quarantineQty: number,
  dailyDemand: number, leadTimeDays: number, stockoutPenaltyPerUnit: number, unitCost: number.positive(),
}).strict();
const scoreSchema = z.object({ ...identity, priorityScore: z.number().finite().min(0).max(100),
  reason: z.string().min(1).max(500) }).strict();
const key = row => row.warehouseId + '/' + row.sku;
function freezeDeep(value) {
  Object.values(value).forEach(child => { if (child && typeof child === 'object') freezeDeep(child); });
  return Object.freeze(value);
}
/** Strategy: function(snapshot, defaults) or module { evaluate(snapshot, defaults) }.
 * Returns exactly one bounded score per input identity; never executable orders.
 */
function evaluateSupplyChainSignals(stateSnapshot, customStrategyFn) {
  const snapshot = z.object({ signals: z.array(signalSchema).max(10000) }).strict().parse(stateSnapshot);
  const keys = new Set(snapshot.signals.map(key));
  if (keys.size !== snapshot.signals.length) throw new Error('Trùng tín hiệu kho/SKU');
  const defaults = snapshot.signals.map(row => {
    const leadDemand = row.dailyDemand * row.leadTimeDays;
    const urgency = leadDemand > 0 ? Math.max(0, 1 - row.atpQty / leadDemand) : 0;
    const impact = Math.min(1, row.stockoutPenaltyPerUnit / row.unitCost);
    return { warehouseId: row.warehouseId, sku: row.sku,
      priorityScore: row.dailyDemand === 0 ? 0 : Math.round((urgency * 0.8 + impact * 0.2) * 10000) / 100,
      reason: '80% thiếu hụt trong lead time, 20% thiệt hại mất bán/giá vốn' };
  });
  let result = defaults;
  if (customStrategyFn !== undefined) {
    const strategy = typeof customStrategyFn === 'function' ? customStrategyFn : customStrategyFn && customStrategyFn.evaluate;
    if (typeof strategy !== 'function') throw new TypeError('Chiến lược phải là hàm hoặc module có evaluate');
    result = strategy(freezeDeep(structuredClone(snapshot)), freezeDeep(structuredClone(defaults)));
  }
  const scores = z.array(scoreSchema).parse(result);
  if (scores.length !== keys.size || new Set(scores.map(key)).size !== keys.size || scores.some(row => !keys.has(key(row)))) {
    throw new Error('Chiến lược phải trả đúng một điểm cho mỗi kho/SKU');
  }
  return scores.sort((a, b) => b.priorityScore - a.priorityScore || key(a).localeCompare(key(b)));
}
module.exports = { evaluateSupplyChainSignals };
