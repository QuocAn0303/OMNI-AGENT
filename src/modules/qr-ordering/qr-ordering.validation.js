/**
 * modules/qr-ordering/qr-ordering.validation.js — Zod schemas cho public QR ordering
 *
 * Public route (không auth) → validation BẮT BUỘC để chặn injection/XSS.
 */
const { z } = require('zod');

const placeOrderSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(99),
    courseId: z.number().int().min(1).max(10).optional().default(1),
    modifiers: z.array(z.object({
      groupId: z.string().uuid(),
      optionIds: z.array(z.string().uuid()).max(20),
    })).max(10).optional(),
  })).min(1).max(50),
  customerName: z.string().trim().max(50).optional(),
  note: z.string().trim().max(200).optional(),
});

const callWaiterSchema = z.object({
  note: z.string().trim().max(200).optional(),
});

const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

module.exports = { placeOrderSchema, callWaiterSchema, feedbackSchema };
