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
 * - listQuerySchema, leadListQuerySchema, dealListQuerySchema, boardQuerySchema,
 *   forecastQuerySchema — parse query string (page/limit/search/enum filter)
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

/**
 * CRM audit M5 — chặn TRÊN cùng với độ chính xác của cột Decimal.
 *
 * `positiveMoney` cũ chỉ chặn số âm. Giá trị vượt độ chính xác cột (`Decimal(15,2)`
 * = tối đa 9 999 999 999 999.99) làm Prisma ném "value out of range" ⇒ `error.middleware`
 * trả **500** thay vì 400 kèm message rõ ràng. Chặn ở Zod ⇒ client nhận 400 ngay.
 *
 * @param {number} intDigits - số chữ số phần nguyên của cột DB
 */
const money = (intDigits = 13) =>
  z.coerce
    .number()
    .min(0, "tiền không được âm")
    .refine((n) => Number.isFinite(n) && Math.abs(n) < 10 ** intDigits, {
      message: `giá trị vượt quá giới hạn lưu trữ (tối đa ${intDigits} chữ số phần nguyên)`,
    });

const positiveMoney = money();

/**
 * Số lượng của dòng deal: khớp `CrmDealItem.quantity Decimal(12,2)`.
 *
 * CRM audit M4 — 2 lỗi do thiếu ràng buộc này:
 *  1. `quantity: 0.001` lọt → Postgres làm tròn `numeric(12,2)` thành **0.00** còn
 *     `amount` giữ giá trị tính từ 0.001 ⇒ `order.service.js` tính
 *     `totalCost / item.quantity` = **Infinity/NaN** ghi vào giá vốn.
 *  2. `quantity: 1.5` lọt (ĐH12,2 cho phép) nhưng `OrderItem.quantity` là **Int** ⇒
 *     `convertToOrder` cắt thành 1 trong khi `subtotal` vẫn tính trên 1.5 ⇒ đơn hàng
 *     sai số lượng và sai tồn kho. Không thể sửa `OrderItem.quantity` (Int) mà không
 *     đụng cả module Inventory/Returns/POS — nên chặn ngay tại đây, và `convertToOrder`
 *     trả 400 nếu gặp số lượng phân số (xem `deals.service.js:assertWholeQuantity`).
 */
const quantity = z.coerce
  .number()
  .positive("số lượng phải > 0")
  .refine((n) => Number.isFinite(n) && n >= 0.01, {
    message: "số lượng tối thiểu 0.01 (nhỏ hơn sẽ bị làm tròn về 0 khi lưu)",
  })
  .refine((n) => Math.round(n * 100) === n * 100, {
    message: "số lượng chỉ nhận tối đa 2 chữ số thập phân",
  });
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
  quantity,
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
  // `.min(0)` cố ý: `PUT {"items": []}` là thao tác "xóa sạch danh sách" hợp lệ.
  // Trước đây nó xoá dòng nhưng GIỮ `value` cũ ⇒ forecast sai (CRM audit M8).
  // `deals.service.upsertItems` nay set `value = 0` khi danh sách rỗng.
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

/**
 * CRM audit M9 — schema này trước đây export nhưng KHÔNG route nào dùng:
 *   - `search` đọc thẳng từ `req.query` không giới hạn ⇒ `?search=<~16KB>` tạo 4
 *     điều kiện `contains` + `mode:"insensitive"` (ILIKE `%…%`, không dùng index)
 *     quét toàn bảng `crm_leads` / `crm_deals`.
 *   - `?status=<không thuộc enum>` đẩy thẳng xuống `where.status` ⇒ Prisma ném
 *     ⇒ **500** thay vì 400.
 * Nay các route list parse bằng `leadListQuerySchema` / `dealListQuerySchema`.
 */
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().trim().max(200, "từ khoá tìm kiếm tối đa 200 ký tự").optional(),
});

const leadListQuerySchema = listQuerySchema.extend({
  status: z.enum(LEAD_STATUSES).optional(),
  stageId: uuid.optional(),
  source: z.string().max(100).optional(),
  organizationId: uuid.optional(),
  leadOwnerId: uuid.optional(),
  overdue: boolish.optional(),
  converted: boolish.optional(),
});

const dealListQuerySchema = listQuerySchema.extend({
  kind: z.enum(STAGE_KINDS).optional(),
  stageId: uuid.optional(),
  organizationId: uuid.optional(),
  contactId: uuid.optional(),
  leadId: uuid.optional(),
  customerId: uuid.optional(),
  dealOwnerId: uuid.optional(),
  converted: boolish.optional(),
  fromDate: dateStr,
  toDate: dateStr,
});

const boardQuerySchema = z.object({
  includeClosed: boolish.optional(),
});

const forecastQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).optional(),
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
  leadListQuerySchema,
  dealListQuerySchema,
  boardQuerySchema,
  forecastQuerySchema,
};
