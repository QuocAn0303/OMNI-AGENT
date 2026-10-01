/**
 * modules/crm/organizations.service.js — Quản lý tổ chức (công ty) trong CRM
 *
 * Tổng quan:
 * - `CrmOrganization` là "công ty" mà lead/contact/deal thuộc về — tương đương
 *   doctype "CRM Organization" của Frappe CRM. Tách riêng `Customer` vì
 *   `Customer` là khách hàng GIAO DỊCH (đơn/công nợ/loyalty), còn Organization chỉ
 *   là thông tin pháp lý/liên hệ ở giai đoạn bán hàng.
 * - Ràng buộc `@@unique([name, tenantId])`: trùng tên trong cùng tenant → 409.
 * - Soft delete: `isActive=false` (không xóa cứng) để giữ liên kết deal/contact.
 *
 * Hàm:
 * - list({page, limit, search, industry, includeInactive}): danh sách phân trang + đếm contact/deal
 * - getById(id): chi tiết + contact & deal gắn với
 * - create(data, userId), update(id, data, userId), remove(id, userId)
 */
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const ApiError = require("../../utils/apiError");
const { ownerScopeForTeam } = require("./scope");
const { getTeamUserIds } = require("./hierarchy.service");

const ORG_SELECT = {
  id: true,
  name: true,
  website: true,
  industry: true,
  annualRevenue: true,
  taxCode: true,
  phone: true,
  address: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

const list = async ({ page = 1, limit = 20, search, industry, includeInactive } = {}) => {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Math.min(200, Number(limit) || 20));

  const where = {};
  if (!includeInactive) where.isActive = true;
  if (industry) where.industry = industry;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { taxCode: { contains: search, mode: "insensitive" } },
      { website: { contains: search, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.crmOrganization.findMany({
      where,
      select: {
        ...ORG_SELECT,
        _count: { select: { contacts: true, deals: true, leads: true } },
      },
      orderBy: { name: "asc" },
      skip: (p - 1) * l,
      take: l,
    }),
    prisma.crmOrganization.count({ where }),
  ]);

  return { organizations: rows, pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) } };
};

/**
 * Chi tiết tổ chức + contact & deal gắn với.
 *
 * CRM audit H2: `CrmOrganization` không có trường owner nên không scope được bản
 * ghi tổ chức, NHƯNG các relation lồng (`deals`, `_count.leads`) kéo theo deal của
 * cả công ty. Trả về không lọc ⇒ CASHIER (theo thiết kế chỉ được xem lead/deal của
 * mình) đọc được tên + giá trị + giai đoạn của MỌI deal trong tổ chức đó.
 * `maskPII` không mask `dealName`/`value` nên lọt hoàn toàn.
 *
 * Sửa: lọc `deals`/`_count.leads` theo đúng `ownerScopeForTeam` mà các endpoint
 * lead/deal dùng — cùng một quy tắc, không tạo lớp phân quyền thứ hai.
 */
const getById = async (id, user) => {
  const team = await getTeamUserIds(user);
  const dealScope = ownerScopeForTeam(user, "dealOwnerId", team);
  const leadScope = ownerScopeForTeam(user, "leadOwnerId", team);

  const org = await prisma.crmOrganization.findUnique({
    where: { id },
    select: {
      ...ORG_SELECT,
      contacts: {
        select: { id: true, fullName: true, email: true, phone: true, jobTitle: true, isPrimary: true, isActive: true },
        orderBy: [{ isPrimary: "desc" }, { fullName: "asc" }],
      },
      deals: {
        where: dealScope,
        select: { id: true, dealName: true, value: true, currency: true, kind: true, expectedCloseDate: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      _count: { select: { leads: { where: leadScope } } },
    },
  });
  if (!org) throw new ApiError(404, "Tổ chức không tồn tại");
  return org;
};

const create = async (data, userId) => {
  let org;
  try {
    org = await prisma.crmOrganization.create({
      data: {
        name: data.name.trim(),
        website: data.website ?? null,
        industry: data.industry ?? null,
        annualRevenue: data.annualRevenue ?? null,
        taxCode: data.taxCode ?? null,
        phone: data.phone ?? null,
        address: data.address ?? null,
        notes: data.notes ?? null,
        isActive: data.isActive ?? true,
      },
      select: ORG_SELECT,
    });
  } catch (e) {
    if (e?.code === "P2002") throw new ApiError(409, `Tổ chức "${data.name}" đã tồn tại`);
    throw e;
  }

  await auditService.log({
    userId,
    action: "CREATE_CRM_ORGANIZATION",
    entity: "CrmOrganization",
    entityId: org.id,
    after: org,
  });
  return org;
};

const update = async (id, data, userId) => {
  const before = await prisma.crmOrganization.findUnique({ where: { id }, select: ORG_SELECT });
  if (!before) throw new ApiError(404, "Tổ chức không tồn tại");

  const patch = {};
  if (data.name !== undefined) patch.name = String(data.name).trim();
  if (data.website !== undefined) patch.website = data.website;
  if (data.industry !== undefined) patch.industry = data.industry;
  if (data.annualRevenue !== undefined) patch.annualRevenue = data.annualRevenue;
  if (data.taxCode !== undefined) patch.taxCode = data.taxCode;
  if (data.phone !== undefined) patch.phone = data.phone;
  if (data.address !== undefined) patch.address = data.address;
  if (data.notes !== undefined) patch.notes = data.notes;
  if (data.isActive !== undefined) patch.isActive = data.isActive;

  let org;
  try {
    org = await prisma.crmOrganization.update({ where: { id }, data: patch, select: ORG_SELECT });
  } catch (e) {
    if (e?.code === "P2002") throw new ApiError(409, `Tổ chức "${patch.name}" đã tồn tại`);
    throw e;
  }

  await auditService.log({
    userId,
    action: "UPDATE_CRM_ORGANIZATION",
    entity: "CrmOrganization",
    entityId: id,
    before,
    after: org,
  });
  return org;
};

/**
 * "Xóa" tổ chức = soft delete. Nếu còn deal/lead/contact thì chặn hẳn (data lịch sử).
 */
const remove = async (id, userId) => {
  const org = await prisma.crmOrganization.findUnique({
    where: { id },
    select: { ...ORG_SELECT, _count: { select: { deals: true, leads: true, contacts: true } } },
  });
  if (!org) throw new ApiError(404, "Tổ chức không tồn tại");

  const attached = org._count.deals + org._count.leads + org._count.contacts;
  if (attached > 0) {
    throw new ApiError(
      409,
      `Tổ chức còn ${attached} bản ghi liên kết (${org._count.deals} deal, ${org._count.leads} lead, ${org._count.contacts} contact) — hãy đặt isActive=false thay vì xóa`,
    );
  }

  await prisma.crmOrganization.update({ where: { id }, data: { isActive: false } });

  await auditService.log({
    userId,
    action: "DELETE_CRM_ORGANIZATION",
    entity: "CrmOrganization",
    entityId: id,
    before: { name: org.name },
  });
  return { id, isActive: false };
};

module.exports = { ORG_SELECT, list, getById, create, update, remove };
