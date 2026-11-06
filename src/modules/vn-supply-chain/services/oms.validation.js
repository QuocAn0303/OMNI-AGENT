'use strict';
const { z } = require('zod');
const { id, initialSchema } = require('./wms.validation');
const qty = z.number().int().min(1).max(100000);
const nonnegative = z.number().int().min(0).max(1000000000);
const time = z.string().datetime({ offset: true });
const items = z.array(z.object({ sku: id, quantity: qty }).strict()).min(1).max(5)
  .refine(rows => new Set(rows.map(r => r.sku)).size === rows.length, 'SKU bị trùng');
const cmd = { requestId: id.max(64) };
const order = z.object({ ...cmd, orderId: id.max(60), channel: z.enum(['Shopee', 'TikTok Shop', 'Website', 'POS']),
  region: z.enum(['MIEN_BAC', 'BAC_TRUNG_BO', 'NAM_TRUNG_BO', 'MIEN_NAM']),
  destinationCity: z.string().min(1).max(100), paymentMethod: z.enum(['COD', 'Prepaid']),
  dispatchDeadlineAt: time, items }).strict();
const orderCmd = z.object({ ...cmd, orderId: id }).strict();
const fulfillmentCmd = z.object({ ...cmd, fulfillmentId: id }).strict();
const pack = fulfillmentCmd.extend({ carrierId: z.enum(['GHN', 'GHTK', 'VTP', 'AHAMOVE_2H']),
  lane: z.enum(['INTRACITY', 'REGIONAL', 'INTERREGIONAL']), distanceKm: z.number().positive().max(3000).default(5),
  measuredWeightGram: qty, measuredVolumeCm3: z.number().int().positive().max(10000000) }).strict();
const attempt = fulfillmentCmd.extend({ attemptNumber: z.number().int().min(1).max(3),
  outcome: z.enum(['DELIVERED', 'FAILED']) }).strict();
const customerReturn = fulfillmentCmd.extend({ reason: z.string().min(1).max(500) }).strict();
const processReturn = z.object({ ...cmd, returnId: id,
  grades: z.array(z.object({ sku: id, aQty: nonnegative, bQty: nonnegative, cQty: nonnegative }).strict()).min(1).max(5)
    .refine(rows => new Set(rows.map(r => r.sku)).size === rows.length, 'Phân loại SKU trùng'),
  repackCostPerUnit: nonnegative.default(5000) }).strict();
const po = z.object({ ...cmd, poId: id.max(60), supplierId: id, warehouseId: z.enum(['WH-HCM', 'WH-HN']),
  promisedAt: time, items }).strict();
const advancePo = z.object({ ...cmd, poId: id,
  status: z.enum(['SUPPLIER_PRODUCTION', 'IN_TRANSIT_INBOUND', 'ARRIVED_AT_DOCK', 'QC_COMPLETED', 'PUTAWAY_DONE']),
  qcResults: z.array(z.object({ sku: id, passQty: nonnegative, defectQty: nonnegative }).strict()).max(5).optional() }).strict();
const capacity = z.object({ unitsPerHour: z.number().int().positive().max(100000).default(100),
  queuedUnits: nonnegative.default(0) }).strict();
const config = z.object({ initialInventory: initialSchema.default([]), clock: z.function().optional(),
  hubCapacity: z.object({ 'WH-HCM': capacity.default({}), 'WH-HN': capacity.default({}) }).strict().default({}) }).strict();
module.exports = { order, orderCmd, fulfillmentCmd, pack, attempt, customerReturn, processReturn, po, advancePo, config };
