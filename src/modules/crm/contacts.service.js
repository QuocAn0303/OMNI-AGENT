/**
 * modules/crm/contacts.service.js — Quản lý người liên hệ trong CRM
 *
 * Tổng quan:
 * - `CrmContact` là "đầu mối người cụ thể" thuộc một `CrmOrganization`
 *   (tương đương doctype "CRM Contact" của Frappe CRM). Tách khỏi `Customer` vì
 *   `Customer` là khách hàng giao dịch; contact có thể chỉ là người đang hỏi thăm.
 * - `customerId` là cầu nối: khi deal thắng / khách thành KH giao dịch thì trỏ
 *   contact đó về `Customer` tương ứng.
 * - `isPrimary`: mỗi tổ chức có tối đa 1 contact chính — đặt primary sẽ tự bỏ
 *   primary của các contact khác cùng tổ chức (transaction, tránh 2 primary).
 * - Index `phone` KHÔNG unique (khác `Customer`): 1 số điện thoại có thể làm
 *   liên hệ ở nhiều tổ chức (đại lý, nhà cung cấp...).
 * - Soft delete: `isActive=false`.
 *
 * Hàm:
 * - list({page, limit, search, organizationId, includeInactive}): danh sách phân trang
 * - getById(id): chi tiết + lead/deal liên quan
 * - create(data, userId), update(id, data, userId), remove(id, userId)
 * - setPrimary(id, userId): đặt làm liên hệ chính của tổ chức
 * - findByPhone(phone): tìm contact theo SĐT (dùng khi convert lead → deal)
 */
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const ApiError = require("../../utils/apiError");
const { ownerScopeForTeam } = require("./scope");
const { getTeamUserIds } = require("./hierarchy.service");

const CONTACT_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  jobTitle: true,
  isPrimary: true,
  organizationId: true,
  customerId: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  organization: { select: { id: true, name: true, industry: true } },
  customer: { select: { id: true, name: true, phone: true, tier: true } },
};

const list = async ({ page = 1, limit = 20, search, organizationId, includeInactive } = {}) => {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Math.min(200, Number(limit) || 20));

  const where = {};
  if (!includeInactive) where.isActive = true;
  if (organizationId) where.organizationId = organizationId;
  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.crmContact.findMany({
      where,
      select: CONTACT_SELECT,
      orderBy: [{ isPrimary: "desc" }, { fullName: "asc" }],
      skip: (p - 1) * l,
      take: l,
    }),
    prisma.crmContact.count({ where }),
  ]);

  return { contacts: rows, pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) } };
};

/**
 * Chi tiết contact + lead/deal liên quan.
 *
 * CRM audit H2: không lọc relation lồng ⇒ CASHIER đọc được tên + trạng thái + giá
 * trị của lead/deal của ĐỒNG NGHIỆP trong cùng tổ chức. Lọc bằng đúng
 * `ownerScopeForTeam` như các endpoint lead/deal — một quy tắc duy nhất.
 */
const getById = async (id, user) => {
  const team = await getTeamUserIds(user);

  const contact = await prisma.crmContact.findUnique({
    where: { id },
    select: {
      ...CONTACT_SELECT,
      leads: {
        where: ownerScopeForTeam(user, "leadOwnerId", team),
        select: { id: true, leadName: true, status: true, expectedValue: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      deals: {
        where: ownerScopeForTeam(user, "dealOwnerId", team),
        select: { id: true, dealName: true, value: true, kind: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
  if (!contact) throw new ApiError(404, "Liên hệ không tồn tại");
  return contact;
};

const findByPhone = async (phone, email) => {
  if (!phone && !email) return null;
  return prisma.crmContact.findFirst({
    where: {
      isActive: true,
      ...(phone ? { phone } : { email }),
    },
    select: CONTACT_SELECT,
    orderBy: { createdAt: "asc" },
  });
};

/** Bỏ cờ primary của các contact khác cùng tổ chức (gọi trong transaction) */
const clearPrimaryInTx = async (tx, organizationId, exceptId) => {
  if (!organizationId) return;
  await tx.crmContact.updateMany({
    where: { organizationId, isPrimary: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isPrimary: false },
  });
};

const create = async (data, userId) => {
  const contact = await prisma.$transaction(async (tx) => {
    await clearPrimaryInTx(tx, data.organizationId ?? null, null);
    return tx.crmContact.create({
      data: {
        fullName: data.fullName.trim(),
        email: data.email ?? null,
        phone: data.phone ?? null,
        jobTitle: data.jobTitle ?? null,
        isPrimary: data.isPrimary ?? false,
        organizationId: data.organizationId ?? null,
        customerId: data.customerId ?? null,
        notes: data.notes ?? null,
        isActive: data.isActive ?? true,
      },
      select: CONTACT_SELECT,
    });
  });

  await auditService.log({
    userId,
    action: "CREATE_CRM_CONTACT",
    entity: "CrmContact",
    entityId: contact.id,
    after: contact,
  });
  return contact;
};

const update = async (id, data, userId) => {
  const before = await prisma.crmContact.findUnique({ where: { id }, select: CONTACT_SELECT });
  if (!before) throw new ApiError(404, "Liên hệ không tồn tại");

  const patch = {};
  if (data.fullName !== undefined) patch.fullName = String(data.fullName).trim();
  if (data.email !== undefined) patch.email = data.email;
  if (data.phone !== undefined) patch.phone = data.phone;
  if (data.jobTitle !== undefined) patch.jobTitle = data.jobTitle;
  if (data.organizationId !== undefined) patch.organizationId = data.organizationId;
  if (data.customerId !== undefined) patch.customerId = data.customerId;
  if (data.notes !== undefined) patch.notes = data.notes;
  if (data.isActive !== undefined) patch.isActive = data.isActive;

  const contact = await prisma.$transaction(async (tx) => {
    // Đổi tổ chức hoặc bật primary → dọn primary của tổ chức MỚI
    const targetOrg = patch.organizationId !== undefined ? patch.organizationId : before.organizationId;
    if (patch.organizationId !== undefined || data.isPrimary === true) {
      await clearPrimaryInTx(tx, targetOrg, id);
    }
    if (data.isPrimary !== undefined) patch.isPrimary = data.isPrimary;
    return tx.crmContact.update({ where: { id }, data: patch, select: CONTACT_SELECT });
  });

  await auditService.log({
    userId,
    action: "UPDATE_CRM_CONTACT",
    entity: "CrmContact",
    entityId: id,
    before,
    after: contact,
  });
  return contact;
};

/** Đặt làm liên hệ chính của tổ chức */
const setPrimary = async (id, userId) => {
  const contact = await prisma.crmContact.findUnique({ where: { id }, select: CONTACT_SELECT });
  if (!contact) throw new ApiError(404, "Liên hệ không tồn tại");
  if (!contact.organizationId) throw new ApiError(400, "Liên hệ chưa gắn tổ chức nào");

  await prisma.$transaction(async (tx) => {
    await clearPrimaryInTx(tx, contact.organizationId, id);
    await tx.crmContact.update({ where: { id }, data: { isPrimary: true } });
  });

  await auditService.log({
    userId,
    action: "SET_PRIMARY_CRM_CONTACT",
    entity: "CrmContact",
    entityId: id,
    after: { organizationId: contact.organizationId, isPrimary: true },
  });
  return { id, isPrimary: true };
};

/**
 * "Xóa" = soft delete. Nếu contact đang gắn deal/lead thì chặn (giữ lịch sử pipeline).
 */
const remove = async (id, userId) => {
  const contact = await prisma.crmContact.findUnique({
    where: { id },
    select: { ...CONTACT_SELECT, _count: { select: { deals: true, leads: true } } },
  });
  if (!contact) throw new ApiError(404, "Liên hệ không tồn tại");

  const attached = contact._count.deals + contact._count.leads;
  if (attached > 0) {
    throw new ApiError(
      409,
      `Liên hệ còn ${attached} bản ghi pipeline liên kết (${contact._count.deals} deal, ${contact._count.leads} lead) — hãy đặt isActive=false thay vì xóa`,
    );
  }

  await prisma.crmContact.update({ where: { id }, data: { isActive: false } });

  await auditService.log({
    userId,
    action: "DELETE_CRM_CONTACT",
    entity: "CrmContact",
    entityId: id,
    before: { fullName: contact.fullName, phone: contact.phone },
  });
  return { id, isActive: false };
};

module.exports = {
  CONTACT_SELECT,
  list,
  getById,
  findByPhone,
  create,
  update,
  setPrimary,
  remove,
};
