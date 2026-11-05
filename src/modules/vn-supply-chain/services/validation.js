'use strict';

const { z } = require('zod');
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Ngày không hợp lệ');
const optionsSchema = z.object({
  startDate: dateSchema.default('2026-11-01'),
  days: z.literal(60).default(60),
  seed: z.number().int().min(0).max(4294967295).default(20261101),
}).strict().refine(value => value.startDate >= '2000-01-01' && value.startDate <= '2099-11-01',
  'Ngày bắt đầu phải thuộc khoảng 2000-01-01 đến 2099-11-01');

const quoteSchema = z.object({
  carrierId: z.enum(['GHN', 'GHTK', 'VTP', 'AHAMOVE_2H']),
  lane: z.enum(['INTRACITY', 'REGIONAL', 'INTERREGIONAL']),
  originCity: z.string().min(1).max(100),
  destinationCity: z.string().min(1).max(100),
  weightGram: z.number().int().positive().max(1000000),
  volumeCm3: z.number().int().positive().max(10000000),
  distanceKm: z.number().positive().max(3000).default(5),
  codAmount: z.number().int().min(0).max(100000000).default(0),
}).strict().superRefine((value, context) => {
  if (value.lane === 'INTRACITY' && value.originCity !== value.destinationCity) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['destinationCity'], message: 'Nội thành phải cùng thành phố' });
  }
  if (value.carrierId === 'AHAMOVE_2H' && (value.lane !== 'INTRACITY'
    || !['TP.HCM', 'Hà Nội'].includes(value.originCity) || value.distanceKm > 15)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['carrierId'], message: 'Ahamove 2H chỉ phục vụ nội thành TP.HCM/Hà Nội trong 15 km mô phỏng' });
  }
});

const logQuerySchema = z.object({
  date: dateSchema.optional(),
  warehouseId: z.enum(['WH-HCM', 'WH-HN']).optional(),
  sku: z.enum(['VN-A-001', 'VN-A-002', 'VN-B-001', 'VN-B-002', 'VN-S-001']).optional(),
  channel: z.enum(['Shopee', 'TikTok Shop', 'Website', 'POS']).optional(),
  page: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(10000)).default('1'),
  limit: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(200)).default('100'),
}).strict();
module.exports = { dateSchema, optionsSchema, quoteSchema, logQuerySchema };
