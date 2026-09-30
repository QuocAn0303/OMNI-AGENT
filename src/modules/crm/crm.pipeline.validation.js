/**
 * modules/crm/crm.pipeline.validation.js — Zod schema cho CRM Sales Pipeline
 *
 * Tổng quan:
 * - Gom toàn bộ validate của 6 router mới (stages/leads/deals/organizations/contacts/
 *   communications/dashboard) vào 1 file để service + route dùng chung.
 * - Quy ước: để ngỏ (`optional`) mọi trường không bắt buộc; số tiền nhận cả string
 *   (Excel hay gửi "5000000") → chuẩn hoá về number ở service.
 * - `partial()` = schema update (mọi field optional) — PATCH chỉ set field có mặt.
 *
 * Hàm (export):
 * - stageCreateSchema, stageUpdateSchema, stageReorderSchema
 * - leadCreateSchema, leadUpdateSchema, leadStageSchema, leadConvertSchema, leadImportSchema
 * - organizationCreateSchema, organizationUpdateSchema
 * - contactCreateSchema, contactUpdateSchema
 * - dealCreateSchema, dealUpdateSchema, dealStageSchema, dealConvertOrderSchema, dealItemSchema
 * - communicationCreateSchema
 * - listQuerySchema — parse query string list (page/limit/search/...)
 */
const { z } = require("zod");

const ENTITY_TYPES = ["LEAD", "DEAL"];
const STAGE_KINDS = ["ONGOING", "WON", "LOST"];
const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "DEAD"];
const COMM_TYPES = ["NOTE", "CALL", "EMAIL", "MEETING", "ZALO", "WHATSAPP", "SYSTEM"];
const COMM_DIRECTIONS = ["INBOUND", "OUTBOUND"];

const uuid = z.string().uuid("phải là uuid hợp lệ");
const uuidOrNull = uuid.nullish();
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "màu phải ở dạng hex #RRGGBB");
const probability = z.coerce.number().int().min(0).max(100);
const positiveMoney = z.coerce.number().min(0, "tiền không được âm");
const dateStr = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ngày phải ở dạng YYYY-MM-DD"))
  .nullish();
const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "string" ? ["1", "true", "yes"].includes(v.toLowerCase()) : v));

// ==================== CrmPipelineStage ====================

const stageCreateSchema = z.object({
  entityType: z.enum(ENTITY_TYPES, { errorMap: () => ({ message: "entityType phải là LEAD hoặc DEAL" }) }),
  label: z.string().min(1, "nhãn không được trống").max(100),
  color: hexColor.optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  kind: z.enum(STAGE_KINDS).optional(),
  probability: probability.optional(),
  isActive: boolish.optional(),
});

const stageUpdateSchema = stageCreateSchema.partial();

const stageReorderSchema = z.object({
  stages: z
    .array(z.object({ id: uuid, sortOrder: z.coerce.number().int().min(0) }))
    .min(1, "cần ít nhất 1 stage để sắp xếp"),
});

// ==================== CrmLead ====================

const leadCreateSchema = z.object({
  leadName: z.string().min(1, "tên không được trống").max(200),
  email: z.string().email("email không hợp lệ").nullish(),
  mobileNo: z.string().min(8, "SĐT tối thiểu 8 ký tự").max(20).nullish(),
  jobTitle: z.string().max(200).nullish(),
  source: z.string().max(100).nullish(),
  status: z.enum(LEAD_STATUSES).optional(),
  stageId: uuidOrNull,
  leadOwnerId: uuidOrNull,
  organizationId: uuidOrNull,
  expectedValue: positiveMoney.nullish(),
  notes: z.string().max(5000).nullish(),
});

const leadUpdateSchema = leadCreateSchema.partial();

const leadStageSchema = z.object({
  stageId: uuid.nullable(),
  status: z.enum(LEAD_STATUSES).optional(),
  // Ngày hẹn liên hệ tiếp theo — dùng cho bộ lọc "quá hạn" (lastContactedAt + 7 ngày)
  lastContactedAt: dateStr,
});

const leadConvertSchema = z.object({
  dealName: z.string().min(1).max(200).optional(),
  organizationId: uuidOrNull,
  contactId: uuidOrNull,
  stageId: uuid.nullable(),
  expectedValue: positiveMoney.nullish(),
  expectedCloseDate: dateStr,
  dealOwnerId: uuidOrNull,
  nextStep: z.string().max(500).nullish(),
  // Tạo CrmContact mới từ thông tin lead (mặc định true — chuẩn Frappe CRM)
  createContact: boolish.optional(),
  note: z.string().max(2000).nullish(),
});

const leadImportSchema = z.object({
  leads: z.array(leadCreateSchema).min(1, "cần ít nhất 1 lead").max(1000, "tối đa 1000 lead/lần"),
  // Bỏ qua lead trùng mobileNo/email thay vì báo lỗi
  skipDuplicates: boolish.optional(),
});

// ==================== CrmOrganization ====================

const organizationCreateSchema = z.object({
  name: z.string().min(1, "tên không được trống").max(200),
  website: z.string().max(300).nullish(),
  industry: z.string().max(200).nullish(),
  annualRevenue: z.coerce.number().min(0).nullish(),
  taxCode: z.string().max(50).nullish(),
  phone: z.string().min(8).max(20).nullish(),
  address: z.string().max(500).nullish(),
  notes: z.string().max(5000).nullish(),
  isActive: boolish.optional(),
});

const organizationUpdateSchema = organizationCreateSchema.partial();

// ==================== CrmContact ====================

const contactCreateSchema = z.object({
  fullName: z.string().min(1, "tên không được trống").max(200),
  email: z.string().email("email không hợp lệ").nullish(),
  phone: z.string().min(8).max(20).nullish(),
  jobTitle: z.string().max(200).nullish(),
  isPrimary: boolish.optional(),
  organizationId: uuidOrNull,
  customerId: uuidOrNull,
  notes: z.string().max(5000).nullish(),
  isActive: boolish.optional(),
});

const contactUpdateSchema = contactCreateSchema.partial();

// ==================== CrmDeal ====================

const dealItemSchema = z.object({
  productId: uuidOrNull,
  description: z.string().max(500).nullish(),
  quantity: z.coerce.number().positive("số lượng phải > 0"),
  unitPrice: positiveMoney,
  discount: positiveMoney.optional(),
});

const dealCreateSchema = z.object({
  dealName: z.string().min(1, "tên deal không được trống").max(200),
  organizationId: uuidOrNull,
  contactId: uuidOrNull,
  leadId: uuidOrNull,
  stageId: uuid.nullable(),
  value: positiveMoney.optional(),
  currency: z.string().min(2).max(10).optional(),
  probability: probability.optional(),
  expectedCloseDate: dateStr,
  nextStep: z.string().max(500).nullish(),
  dealOwnerId: uuidOrNull,
  lostReason: z.string().max(500).nullish(),
  items: z.array(dealItemSchema).max(200, "tối đa 200 dòng").optional(),
});

const dealUpdateSchema = dealCreateSchema.partial().omit({ items: true });

const dealStageSchema = z.object({
  stageId: uuid.nullable(),
  lostReason: z.string().max(500).nullish(),
});

const dealConvertOrderSchema = z.object({
  customerId: uuid.optional(),
  // Cho phép tạo khách hàng mới khi deal thắng mà chưa có khách hàng liên kết
  createCustomer: boolish.optional(),
  warehouseId: uuid.optional(),
  orderStatus: z.enum(["PENDING", "CONFIRMED", "COMPLETED"]).optional(),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CARD"]).optional(),
  note: z.string().max(500).optional(),
});

// ==================== CrmCommunication ====================

const communicationCreateSchema = z.object({
  type: z.enum(COMM_TYPES, {
    errorMap: () => ({ message: `type phải là: ${COMM_TYPES.join(", ")}` }),
  }),
  direction: z.enum(COMM_DIRECTIONS).nullish(),
  subject: z.string().max(300).nullish(),
  content: z.string().min(1, "nội dung không được trống").max(10000),
  durationSec: z.coerce.number().int().min(0).nullish(),
  leadId: uuidOrNull,
  dealId: uuidOrNull,
  contactId: uuidOrNull,
});

// ==================== Query string ====================

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().max(200).optional(),
});

module.exports = {
  ENTITY_TYPES,
  STAGE_KINDS,
  LEAD_STATUSES,
  COMM_TYPES,
  COMM_DIRECTIONS,
  stageCreateSchema,
  stageUpdateSchema,
  stageReorderSchema,
  leadCreateSchema,
  leadUpdateSchema,
  leadStageSchema,
  leadConvertSchema,
  leadImportSchema,
  organizationCreateSchema,
  organizationUpdateSchema,
  contactCreateSchema,
  contactUpdateSchema,
  dealCreateSchema,
  dealUpdateSchema,
  dealStageSchema,
  dealConvertOrderSchema,
  dealItemSchema,
  communicationCreateSchema,
  listQuerySchema,
};
