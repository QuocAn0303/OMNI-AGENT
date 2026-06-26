/**
 * modules/subscriptions/subscription.validation.js — Zod schemas cho subscription
 * 
 * Tổng quan:
 * - Định nghĩa validation schemas cho các request của subscription module
 * 
 * Schemas:
 * - createPlanSchema: name, key (bắt buộc), price, currency, durationDays, features, sortOrder
 * - updatePlanSchema: Partial của createPlanSchema
 * - assignPlanSchema: planId (uuid), note, autoRenew
 * - generateInvoiceSchema: subscriptionId (uuid)
 * - updateInvoiceSchema: status (enum PENDING/PAID/OVERDUE/CANCELLED/REFUNDED), paymentMethod
 */
const { z } = require("zod");

const createPlanSchema = z.object({
  name: z.string().min(1, "Tên gói không được để trống"),
  key: z.string().min(1, "Key không được để trống"),
  description: z.string().optional(),
  price: z.number().min(0, "Giá không được âm"),
  currency: z.string().default("VND"),
  durationDays: z.number().int().min(1).default(30),
  features: z.record(z.any()).default({}),
  sortOrder: z.number().int().default(0),
});

const updatePlanSchema = createPlanSchema.partial();

const assignPlanSchema = z.object({
  planId: z.string().uuid(),
  note: z.string().optional(),
  autoRenew: z.boolean().optional(),
});

const generateInvoiceSchema = z.object({
  subscriptionId: z.string().uuid(),
});

const updateInvoiceSchema = z.object({
  status: z.enum(["PENDING", "PAID", "OVERDUE", "CANCELLED", "REFUNDED"]),
  paymentMethod: z.string().optional(),
});

module.exports = {
  createPlanSchema,
  updatePlanSchema,
  assignPlanSchema,
  generateInvoiceSchema,
  updateInvoiceSchema,
};
