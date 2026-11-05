'use strict';
const { z } = require('zod');
const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const qty = z.number().int().min(0).max(1000000000);
const positiveQty = qty.refine(n => n > 0, 'Số lượng phải dương');
const timestamp = z.string().datetime({ offset: true });
const item = z.object({ sku: id, quantity: positiveQty }).strict();
const uniqueItems = schema => z.array(schema).min(1).max(100).refine(rows => new Set(rows.map(r => r.sku)).size === rows.length, 'SKU bị trùng');
const command = { requestId: id };
const order = { orderId: id, warehouseId: id, channel: z.enum(['Shopee', 'TikTok Shop', 'Website', 'POS']), items: uniqueItems(item) };
const binCounts = z.array(z.object({ sku: id, binId: id, actualOnHandQty: qty }).strict()).max(100)
  .refine(rows => new Set(rows.map(r => r.sku + '/' + r.binId)).size === rows.length, 'Ô kiểm đếm bị trùng').default([]);
const shipmentSchema = z.object({ ...command, shipmentId: id, sourceId: id,
  sourceType: z.enum(['PO', 'TRANSFER']), supplierId: id.optional(), sourceWarehouseId: id.optional(),
  warehouseId: id, quarantineBinId: id, items: uniqueItems(item),
  expectedArrivalAt: timestamp, expectedAvailableAt: timestamp,
}).strict();
const receiveSchema = z.object({ ...command, shipmentId: id, receiptId: id,
  items: uniqueItems(item.extend({ passQty: qty.optional(), defectQty: qty.optional() }).superRefine((r, ctx) => {
    if ((r.passQty === undefined) !== (r.defectQty === undefined)
      || (r.passQty !== undefined && r.passQty + r.defectQty !== r.quantity)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'QC phải có passQty + defectQty = quantity' });
    }
  })),
}).strict();
const inspectSchema = z.object({ ...command, receiptId: id,
  results: uniqueItems(z.object({ sku: id, passQty: qty, defectQty: qty }).strict()),
}).strict();
const returnSchema = z.object({ ...command, receiptId: id, orderId: id, receivingBinId: id,
  quarantineBinId: id, items: uniqueItems(item) }).strict();
const putawaySchema = z.object({ ...command, receiptId: id, sku: id, binId: id, quantity: positiveQty }).strict();
const defectSchema = z.object({ ...command, receiptId: id, sku: id, quantity: positiveQty }).strict();
const orderSchema = z.object({ ...command, ...order }).strict();
const pickSchema = z.object({ ...command, ...order, binCounts }).strict();
const waveSchema = z.object({ ...command, orders: z.array(z.object({ ...order, binCounts }).strict()).min(1).max(100)
  .refine(rows => new Set(rows.map(r => r.orderId)).size === rows.length, 'Đơn bị trùng') }).strict();
const packSchema = z.object({ ...command, orderId: id,
  carrierId: z.enum(['GHN', 'GHTK', 'VTP', 'AHAMOVE_2H']),
  lane: z.enum(['INTRACITY', 'REGIONAL', 'INTERREGIONAL']), destinationCity: z.string().min(1).max(100),
  distanceKm: z.number().positive().max(3000).default(5),
  measuredWeightGram: positiveQty, measuredVolumeCm3: positiveQty,
}).strict();
const orderCommandSchema = z.object({ ...command, orderId: id }).strict();
const stockQuerySchema = z.object({ warehouseId: id, sku: id, binId: id.optional() }).strict();
const projectionSchema = z.object({ warehouseId: id, sku: id, daysAhead: z.number().int().min(0).max(365),
  dailyDemand: z.number().finite().min(0).max(1000000).optional(),
  forecastDaily: z.array(z.number().finite().min(0).max(1000000)).max(365).optional(),
}).strict().refine(r => !(r.dailyDemand !== undefined && r.forecastDaily !== undefined), 'Chỉ chọn một loại dự báo')
  .refine(r => !r.forecastDaily || r.forecastDaily.length === r.daysAhead, 'Phải đủ dự báo từng ngày');
const initialSchema = z.array(z.object({ warehouseId: id, sku: id, binId: id, quantity: qty }).strict()).max(10000)
  .refine(rows => new Set(rows.map(r => r.warehouseId + '/' + r.sku + '/' + r.binId)).size === rows.length, 'Trùng tồn đầu');
module.exports = { id, qty, shipmentSchema, receiveSchema, inspectSchema, putawaySchema, defectSchema,
  orderSchema, pickSchema, waveSchema, packSchema, orderCommandSchema, stockQuerySchema, projectionSchema, initialSchema, returnSchema };
