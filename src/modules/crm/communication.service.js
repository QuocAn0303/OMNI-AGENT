/**
 * modules/crm/communication.service.js — Unified timeline của CRM Sales Pipeline
 *
 * Tổng quan:
 * - Frappe CRM có "Communication" + "System Event" gộp chung 1 timeline. Ở đây
 *   cả 2 loại đều nằm trong bảng `CrmCommunication`:
 *     - type = NOTE/CALL/EMAIL/MEETING/ZALO/WHATSAPP → người dùng nhập tay
 *     - type = SYSTEM                                      → hệ thống ghi (đổi stage,
 *       đổi người phụ trách, convert lead → deal, tạo đơn hàng)
 *   Nhờ vậy `listTimeline` chỉ cần 1 query, không phải merge 2 nguồn.
 * - Timeline có thể xem theo lead, theo deal, hoặc theo contact.
 *
 * Vì sao `logSystemEvent` best-effort:
 * - Ghi timeline là hành vi phụ (audit trail hiển thị), KHÔNG được làm hỏng
 *   nghiệp vụ chính (đổi stage/convert deal) nếu insert lỗi → nuốt lỗi + log.
 *   Ngược lại với `create` (do người dùng bấm) thì lỗi phải ném ra.
 *
 * Hàm:
 * - listTimeline({ leadId, dealId, contactId, type, page, limit }): timeline đã gộp
 * - create(data, userId): thêm 1 entry thủ công (NOTE/CALL/EMAIL/...)
 * - remove(id, user): xóa entry (chỉ ADMIN/MANAGER hoặc chính người tạo)
 * - logSystemEvent({ leadId, dealId, contactId, content, createdById, meta }): ghi system event
 */
const prisma = require("../../config/prisma");
const logger = require("../../utils/logger");
const { canAccess } = require("./scope");
const ApiError = require("../../utils/apiError");

const COMM_SELECT = {
  id: true,
  type: true,
  direction: true,
  subject: true,
  content: true,
  durationSec: true,
  leadId: true,
  dealId: true,
  contactId: true,
  createdById: true,
  createdAt: true,
  createdBy: { select: { id: true, fullName: true, role: true } },
  lead: { select: { id: true, leadName: true } },
  deal: { select: { id: true, dealName: true } },
  contact: { select: { id: true, fullName: true } },
};

/**
 * Lấy timeline. Bắt buộc có ít nhất 1 trong leadId/dealId/contactId.
 * @param {{leadId?:string, dealId?:string, contactId?:string, type?:string, page?:number, limit?:number}} params
 */
const listTimeline = async ({ leadId, dealId, contactId, type, page = 1, limit = 50 } = {}) => {
  if (!leadId && !dealId && !contactId) {
    throw new ApiError(400, "Cần ít nhất leadId, dealId hoặc contactId để xem timeline");
  }
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Math.min(200, Number(limit) || 50));

  const where = {};
  if (leadId) where.leadId = leadId;
  if (dealId) where.dealId = dealId;
  if (contactId) where.contactId = contactId;
  if (type) where.type = type;

  const [rows, total] = await Promise.all([
    prisma.crmCommunication.findMany({
      where,
      select: COMM_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (p - 1) * l,
      take: l,
    }),
    prisma.crmCommunication.count({ where }),
  ]);

  return {
    timeline: rows,
    pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) },
  };
};

const create = async (data, userId) => {
  if (!data.leadId && !data.dealId && !data.contactId) {
    throw new ApiError(400, "Ghi chú phải gắn với ít nhất lead, deal hoặc contact");
  }
  if (data.type === "SYSTEM") {
    throw new ApiError(400, "Loại SYSTEM do hệ thống tự sinh, không tạo thủ công được");
  }

  return prisma.crmCommunication.create({
    data: {
      type: data.type,
      direction: data.direction ?? null,
      subject: data.subject ?? null,
      content: data.content,
      durationSec: data.durationSec ?? null,
      leadId: data.leadId ?? null,
      dealId: data.dealId ?? null,
      contactId: data.contactId ?? null,
      createdById: userId ?? null,
    },
    select: COMM_SELECT,
  });
};

/**
 * Xóa entry — CASHIER chỉ xóa được entry do chính mình tạo (record-level permission).
 * @param {string} id
 * @param {Object} user - req.user
 */
const remove = async (id, user) => {
  const row = await prisma.crmCommunication.findUnique({
    where: { id },
    select: { id: true, type: true, createdById: true, lead: { select: { leadOwnerId: true } }, deal: { select: { dealOwnerId: true } } },
  });
  if (!row) throw new ApiError(404, "Ghi chú không tồn tại");

  const isManager = user && ["SUPER_OMEGA_ULTRA_ADMIN", "SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role);
  const owns = row.createdById === user?.id;
  const ownsRecord = canAccess(user, row.lead, "leadOwnerId") || canAccess(user, row.deal, "dealOwnerId");
  if (!isManager && !owns && !ownsRecord) {
    throw new ApiError(403, "Bạn không có quyền xóa ghi chú này");
  }
  if (row.type === "SYSTEM") {
    throw new ApiError(409, "Không xóa được sự kiện hệ thống trong timeline");
  }

  await prisma.crmCommunication.delete({ where: { id } });
  return { id };
};

/**
 * Ghi system event vào timeline — best-effort, KHÔNG ném lỗi.
 * Dùng sau mỗi thao tác đổi stage / gán owner / convert để có audit trail hiển thị.
 * @returns {Promise<Object|null>} row vừa tạo, hoặc null nếu ghi lỗi
 */
const logSystemEvent = async ({ leadId, dealId, contactId, content, subject, createdById }) => {
  if (!leadId && !dealId && !contactId) return null;
  try {
    return await prisma.crmCommunication.create({
      data: {
        type: "SYSTEM",
        direction: null,
        subject: subject ?? null,
        content,
        leadId: leadId ?? null,
        dealId: dealId ?? null,
        contactId: contactId ?? null,
        createdById: createdById ?? null,
      },
      select: COMM_SELECT,
    });
  } catch (e) {
    logger.error("[crm] logSystemEvent failed:", e.message);
    return null;
  }
};

module.exports = {
  COMM_SELECT,
  listTimeline,
  create,
  remove,
  logSystemEvent,
};
