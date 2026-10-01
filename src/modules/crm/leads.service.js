/**
 * modules/crm/leads.service.js — Nghiệp vụ Lead của CRM Sales Pipeline
 *
 * Tổng quan:
 * - `CrmLead` là khách hàng tiềm năng (doctype "CRM Lead" của Frappe CRM) — tách
 *   riêng hoàn toàn khỏi `Customer`. `Customer` chỉ được sinh ra khi deal thắng
 *   (đó là semantics của Frappe/ERPNext).
 * - Mỗi lead có `leadOwnerId` (nhân viên phụ trách) → CASHIER chỉ thấy lead của
 *   mình, MANAGER/ADMIN thấy tất cả (xem `scope.js`).
 * - Mọi thay đổi nghiệp vụ (đổi stage, gán owner, convert) đều ghi 1 dòng
 *   `type=SYSTEM` vào timeline (`communication.service.logSystemEvent`).
 *
 * Hàm:
 * - list(query, user): danh sách lead phân trang + filter
 *   (status/stageId/leadOwnerId/source/search/overdue/converted)
 * - getById(id, user): chi tiết + deal đã convert
 * - create(data, userId, user), update(id, data, userId, user), remove(id, userId, user)
 * - changeStage(id, data, userId, user): đổi stage (dùng cho drag-drop kanban)
 * - convertToDeal(id, payload, userId, user): LEAD → DEAL (tạo/link contact, tạo deal)
 * - importList(rows, userId): nhập nhiều lead, bỏ qua trùng mobileNo/email
 * - listFields(user): metadata cho form/filter (status, stage, source, owner)
 */
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const notif = require("../notifications/notification.service");
const ApiError = require("../../utils/apiError");
const stagesService = require("./stages.service");
const contactsService = require("./contacts.service");
const communicationService = require("./communication.service");
const { ownerScopeForTeam, assertAccess, isManager, assertRefsInTenant, resolveOwnerId } = require("./scope");
const { getTeamUserIds } = require("./hierarchy.service");

// Lead chưa liên hệ quá 7 ngày được coi là "quá hạn" (sắp quên mất)
const OVERDUE_DAYS = 7;

const LEAD_SELECT = {
  id: true,
  leadName: true,
  email: true,
  mobileNo: true,
  jobTitle: true,
  source: true,
  status: true,
  stageId: true,
  leadOwnerId: true,
  organizationId: true,
  contactId: true,
  expectedValue: true,
  convertedAt: true,
  convertedDealId: true,
  lastContactedAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  stage: { select: { id: true, label: true, color: true, sortOrder: true, kind: true, probability: true } },
  leadOwner: { select: { id: true, fullName: true, role: true } },
  organization: { select: { id: true, name: true } },
  contact: { select: { id: true, fullName: true, email: true, phone: true } },
};

/** Chuyển `YYYY-MM-DD` hoặc ISO sang Date; null/undefined → null */
const toDate = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * CRM audit H10 — dịch lỗi unique của Postgres (P2002) thành 409 nói rõ trường.
 *
 * `CrmLead` giờ có `@@unique([mobileNo, tenantId])` + `@@unique([email, tenantId])`
 * nên tạo lead trùng bị DB chặn. Không bắt thì người dùng thấy 500 "Internal Error".
 */
const translateDuplicateLead = (e) => {
  if (e?.code !== "P2002") return null;
  const target = Array.isArray(e?.meta?.target) ? e.meta.target.join(", ") : String(e?.meta?.target || "");
  if (/mobileNo/i.test(target)) return new ApiError(409, "Số điện thoại này đã tồn tại trong danh sách lead");
  if (/email/i.test(target)) return new ApiError(409, "Email này đã tồn tại trong danh sách lead");
  return new ApiError(409, "Lead đã tồn tại (trùng số điện thoại hoặc email)");
};

/**
 * Danh sách lead — record-level permission theo owner.
 * @param {Object} query - {page, limit, status, stageId, leadOwnerId, source, search, overdue}
 * @param {Object} user - req.user
 */
const list = async (query = {}, user) => {
  const p = Math.max(1, Number(query.page) || 1);
  const l = Math.max(1, Math.min(200, Number(query.limit) || 20));

  // CRM Phase 4: manager xem theo cây báo cáo (mình + bậc dưới) thay vì toàn tenant.
  const where = { ...ownerScopeForTeam(user, "leadOwnerId", await getTeamUserIds(user)) };
  if (query.status) where.status = query.status;
  if (query.stageId) where.stageId = query.stageId;
  if (query.source) where.source = query.source;
  if (query.organizationId) where.organizationId = query.organizationId;
  // QUAN TRỌNG: chỉ role quản lý mới được lọc theo owner khác. Gán TRƯỚC mọi filter
  // khác để không bao giờ ghi đè ràng buộc "CASHIER chỉ thấy lead của mình".
  if (query.leadOwnerId && isManager(user)) where.leadOwnerId = query.leadOwnerId;
  if (query.overdue === "1" || query.overdue === true || query.overdue === "true") {
    where.status = where.status || { in: ["NEW", "CONTACTED", "QUALIFIED"] };
    where.lastContactedAt = {
      lt: new Date(Date.now() - OVERDUE_DAYS * 24 * 60 * 60 * 1000),
    };
  }
  if (query.search) {
    where.OR = [
      { leadName: { contains: query.search, mode: "insensitive" } },
      { email: { contains: query.search, mode: "insensitive" } },
      { mobileNo: { contains: query.search } },
      { jobTitle: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.crmLead.findMany({
      where,
      select: LEAD_SELECT,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: (p - 1) * l,
      take: l,
    }),
    prisma.crmLead.count({ where }),
  ]);

  return { leads: rows, pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) } };
};

/**
 * CRM Phase 4 — assertAccess theo cây báo cáo.
 * Manager được xem record của mình + bậc dưới (không phải toàn tenant).
 * Bọc 1 chỗ để các call site chỉ cần `assertLeadAccess(user, record)`.
 */
const assertLeadAccess = async (user, record, entityName = "Lead") => {
  const team = await getTeamUserIds(user);
  return assertAccess(user, record, "leadOwnerId", entityName, team);
};

const getById = async (id, user) => {
  const lead = await prisma.crmLead.findUnique({
    where: { id },
    select: {
      ...LEAD_SELECT,
      deals: {
        select: { id: true, dealName: true, value: true, currency: true, kind: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  await assertLeadAccess(user, lead);
  return lead;
};

/** Kiểm tra stage có thuộc đúng entityType không (Lead không dùng stage của Deal) */
const assertLeadStage = async (stageId) => {
  if (!stageId) return null;
  const stage = await prisma.crmPipelineStage.findUnique({
    where: { id: stageId },
    select: { id: true, entityType: true, label: true, kind: true, probability: true, isActive: true },
  });
  if (!stage) throw new ApiError(404, "Giai đoạn không tồn tại");
  if (stage.entityType !== "LEAD") throw new ApiError(400, "Giai đoạn này thuộc kanban Deal, không dùng cho Lead");
  return stage;
};

/** Kiểm tra mọi FK trỏ sang bảng khác phải nằm trong tenant (CRM audit H3) */
const assertLeadRefs = (data) =>
  assertRefsInTenant([
    { model: "crmOrganization", id: data.organizationId, label: "Tổ chức" },
    { model: "crmContact", id: data.contactId, label: "Liên hệ" },
    { model: "user", id: data.leadOwnerId, label: "Người phụ trách" },
  ]);

const create = async (data, userId, user) => {
  await assertLeadStage(data.stageId);
  // H7: không phải quản lý thì KHÔNG tự gán owner cho người khác được.
  // Không chỉ đăng nhập owner → CASHIER tự nhận lead mình tạo, MANAGER/ADMIN để trống (giao sau)
  const ownerId = resolveOwnerId(data.leadOwnerId, user);
  await assertLeadRefs({ ...data, leadOwnerId: ownerId });

  let lead;
  try {
    lead = await prisma.crmLead.create({
      data: {
        leadName: data.leadName.trim(),
        email: data.email ?? null,
        mobileNo: data.mobileNo ?? null,
        jobTitle: data.jobTitle ?? null,
        source: data.source ?? null,
        status: data.status ?? "NEW",
        stageId: data.stageId ?? null,
        leadOwnerId: ownerId,
        organizationId: data.organizationId ?? null,
        contactId: data.contactId ?? null,
        expectedValue: data.expectedValue ?? null,
        lastContactedAt: toDate(data.lastContactedAt) ?? null,
        notes: data.notes ?? null,
      },
      select: LEAD_SELECT,
    });
  } catch (e) {
    throw translateDuplicateLead(e) || e;
  }

  await auditService.log({
    userId,
    action: "CREATE_CRM_LEAD",
    entity: "CrmLead",
    entityId: lead.id,
    after: { leadName: lead.leadName, status: lead.status, leadOwnerId: lead.leadOwnerId, source: lead.source },
  });

  await communicationService.logSystemEvent({
    leadId: lead.id,
    content: `Tạo lead mới${lead.source ? ` từ nguồn ${lead.source}` : ""}`,
    createdById: userId,
  });

  if (ownerId && ownerId !== userId) {
    await notif
      .createOne({
        type: "SYSTEM",
        severity: "INFO",
        title: "Bạn được giao lead mới",
        message: lead.leadName,
        link: `/crm/leads/${lead.id}`,
        userId: ownerId,
        meta: { leadId: lead.id },
      })
      .catch(() => null);
  }

  return lead;
};

const update = async (id, data, userId, user) => {
  const before = await prisma.crmLead.findUnique({ where: { id }, select: LEAD_SELECT });
  await assertLeadAccess(user, before);
  if (data.stageId !== undefined) await assertLeadStage(data.stageId);

  const patch = {};
  if (data.leadName !== undefined) patch.leadName = String(data.leadName).trim();
  if (data.email !== undefined) patch.email = data.email;
  if (data.mobileNo !== undefined) patch.mobileNo = data.mobileNo;
  if (data.jobTitle !== undefined) patch.jobTitle = data.jobTitle;
  if (data.source !== undefined) patch.source = data.source;
  if (data.status !== undefined) patch.status = data.status;
  if (data.stageId !== undefined) patch.stageId = data.stageId;
  if (data.organizationId !== undefined) patch.organizationId = data.organizationId;
  if (data.contactId !== undefined) patch.contactId = data.contactId;
  if (data.expectedValue !== undefined) patch.expectedValue = data.expectedValue;
  if (data.notes !== undefined) patch.notes = data.notes;
  // H7: CASHIER sửa lead của chính mình mà gửi `leadOwnerId` của đồng nghiệp sẽ bị
  // ép về `user.id` (giữ nguyên) thay vì đẩy việc + bắn notification cho người khác.
  if (data.leadOwnerId !== undefined) patch.leadOwnerId = resolveOwnerId(data.leadOwnerId, user);
  if (data.lastContactedAt !== undefined) patch.lastContactedAt = toDate(data.lastContactedAt);

  await assertLeadRefs({ ...data, leadOwnerId: patch.leadOwnerId ?? before.leadOwnerId });

  let lead;
  try {
    lead = await prisma.crmLead.update({ where: { id }, data: patch, select: LEAD_SELECT });
  } catch (e) {
    throw translateDuplicateLead(e) || e;
  }

  await auditService.log({
    userId,
    action: "UPDATE_CRM_LEAD",
    entity: "CrmLead",
    entityId: id,
    before: { status: before.status, stageId: before.stageId, leadOwnerId: before.leadOwnerId },
    after: { status: lead.status, stageId: lead.stageId, leadOwnerId: lead.leadOwnerId },
  });

  if (patch.leadOwnerId && patch.leadOwnerId !== before.leadOwnerId && patch.leadOwnerId !== userId) {
    await communicationService.logSystemEvent({
      leadId: id,
      content: `Chuyển người phụ trách: ${before.leadOwner?.fullName || "—"} → ${lead.leadOwner?.fullName || "—"}`,
      createdById: userId,
    });
    await notif
      .createOne({
        type: "SYSTEM",
        severity: "INFO",
        title: "Lead được chuyển cho bạn",
        message: lead.leadName,
        link: `/crm/leads/${id}`,
        userId: patch.leadOwnerId,
        meta: { leadId: id },
      })
      .catch(() => null);
  }

  return lead;
};

/** Xóa lead — chặn nếu đã convert (đã sinh deal) để không mất liên kết lịch sử */
const remove = async (id, userId, user) => {
  const lead = await prisma.crmLead.findUnique({
    where: { id },
    select: { id: true, leadName: true, status: true, convertedDealId: true, leadOwnerId: true, _count: { select: { deals: true } } },
  });
  await assertLeadAccess(user, lead);
  if (lead.status === "CONVERTED" || lead._count.deals > 0) {
    throw new ApiError(409, "Lead đã chuyển thành Deal — không xóa được, hãy đặt trạng thái DEAD thay vì xóa");
  }

  // Xóa luôn timeline của lead (CrmCommunication.leadId không có FK cascade)
  await prisma.$transaction([
    prisma.crmCommunication.deleteMany({ where: { leadId: id } }),
    prisma.crmLead.delete({ where: { id } }),
  ]);

  await auditService.log({
    userId,
    action: "DELETE_CRM_LEAD",
    entity: "CrmLead",
    entityId: id,
    before: { leadName: lead.leadName, status: lead.status },
  });
  return { id };
};

/**
 * Đổi stage/status cho lead — endpoint chính của drag-drop kanban.
 * Đồng thời set `lastContactedAt` khi có thay đổi trạng thái liên hệ.
 */
const changeStage = async (id, data, userId, user) => {
  const before = await prisma.crmLead.findUnique({ where: { id }, select: LEAD_SELECT });
  await assertLeadAccess(user, before);
  if (before.status === "CONVERTED") {
    throw new ApiError(409, "Lead đã chuyển thành Deal, không đổi stage được");
  }
  const stage = await assertLeadStage(data.stageId);

  const patch = {
    stageId: data.stageId ?? null,
    ...(data.status ? { status: data.status } : {}),
  };
  if (data.lastContactedAt !== undefined) {
    patch.lastContactedAt = toDate(data.lastContactedAt);
  } else if (data.status && data.status !== before.status) {
    // Đổi trạng thái CONTACTED/QUALIFIED → coi như vừa liên hệ
    patch.lastContactedAt = new Date();
  }

  const lead = await prisma.crmLead.update({ where: { id }, data: patch, select: LEAD_SELECT });

  await auditService.log({
    userId,
    action: "CHANGE_CRM_LEAD_STAGE",
    entity: "CrmLead",
    entityId: id,
    before: { stageId: before.stageId, status: before.status },
    after: { stageId: lead.stageId, status: lead.status },
  });

  await communicationService.logSystemEvent({
    leadId: id,
    content: `Chuyển giai đoạn: ${before.stage?.label || "—"} → ${lead.stage?.label || "—"}`,
    createdById: userId,
  });

  if (stage?.label) {
    return { lead, stageLabel: stage.label };
  }
  return { lead, stageLabel: null };
};

/**
 * Chốt "chuyển thành Deal" cho một lead.
 * Trong 1 transaction:
 *   1. Tìm hoặc tạo CrmContact từ thông tin lead (tuỳ `createContact`)
 *   2. Tạo CrmDeal ở stage ONGOING đầu tiên (probability/kind snapshot từ stage)
 *   3. Set lead.status=CONVERTED + convertedDealId + convertedAt
 * Sau đó ghi system event và audit.
 * @param {string} id - leadId
 * @param {Object} payload - dealName/organizationId/contactId/stageId/expectedValue/...
 * @param {string} userId
 * @param {Object} user - req.user
 */
const convertToDeal = async (id, payload = {}, userId, user) => {
  const lead = await prisma.crmLead.findUnique({ where: { id }, select: LEAD_SELECT });
  await assertLeadAccess(user, lead);

  if (lead.status === "CONVERTED") {
    throw new ApiError(409, "Lead này đã được chuyển thành Deal trước đó", {
      convertedDealId: lead.convertedDealId,
    });
  }

  const organizationId = payload.organizationId ?? lead.organizationId ?? null;
  const createContact = payload.createContact !== false;
  let contactId = payload.contactId ?? lead.contactId ?? null;

  // CRM audit H3: FK trong Postgres không kiểm tenantId → org/contact của tenant khác
  // lọt vào. Kiểm trước khi ghi bất cứ thứ gì.
  await assertRefsInTenant([
    { model: "crmOrganization", id: organizationId, label: "Tổ chức" },
    { model: "crmContact", id: contactId, label: "Liên hệ" },
    { model: "user", id: payload.dealOwnerId, label: "Người phụ trách deal" },
  ]);

  const stageId = payload.stageId ?? null;
  let stage = null;
  if (stageId) {
    stage = await prisma.crmPipelineStage.findUnique({
      where: { id: stageId },
      select: { id: true, entityType: true, label: true, kind: true, probability: true },
    });
    if (!stage) throw new ApiError(404, "Giai đoạn không tồn tại");
    if (stage.entityType !== "DEAL") throw new ApiError(400, "Giai đoạn này thuộc kanban Lead, không dùng cho Deal");
  } else {
    stage = await stagesService.firstOngoingStage("DEAL");
  }

  const kind = stage?.kind === "WON" || stage?.kind === "LOST" ? stage.kind : "ONGOING";
  // H7: non-manager không tự gán deal cho người khác được
  const dealOwnerId = resolveOwnerId(payload.dealOwnerId ?? lead.leadOwnerId, user);
  const expectedValue = payload.expectedValue ?? lead.expectedValue ?? 0;

  /**
   * H4 — 2 phần sửa so với bản cũ:
   *  1. Contact tạo MỚI nằm trong cùng transaction với deal. Trước đây
   *     `contactsService.create` chạy trước transaction ⇒ deal create lỗi thì
   *     để lại contact mồ côi nhưng audit log vẫn ghi "đã chuyển thành Deal".
   *  2. Guard 409 chuyển từ check-then-act (đọc `lead` ở dòng trên) sang
   *     conditional update TRONG transaction:
   *       `updateMany({ where: { id, status: { not: "CONVERTED" } } })`
   *     2 request `/convert` song song trước đây cùng đọc `status = "QUALIFIED"` và
   *     cùng tạo 1 deal (2 deal thừa cùng `leadId`, `convertedDealId` chỉ giữ 1,
   *     deal thừa vẫn được tính vào forecast).
   */
  const result = await prisma.$transaction(async (tx) => {
    // Chiếm lead TRƯỚC khi tạo contact: nếu thua race thì dừng ngay, không sinh
    // thêm contact/deal mồ côi.
    const claim = await tx.crmLead.updateMany({
      where: { id: lead.id, status: { not: "CONVERTED" } },
      data: { status: "CONVERTED", convertedAt: new Date() },
      select: { id: true },
    });
    if (claim.count !== 1) {
      throw new ApiError(409, "Lead này vừa được chuyển thành Deal bởi người khác", {
        convertedDealId: lead.convertedDealId,
      });
    }

    let resolvedContactId = contactId;
    if (!resolvedContactId && createContact) {
      const existing = await tx.crmContact.findFirst({
        where: {
          isActive: true,
          ...(lead.mobileNo ? { phone: lead.mobileNo } : { email: lead.email }),
        },
        select: { id: true },
      });
      if (existing) {
        resolvedContactId = existing.id;
      } else {
        // Tạo contact trong transaction. Không dùng `contactsService.create` (nó
        // mở transaction riêng + ghi audit) — tự tạo ở đây, audit gộp 1 lần.
        const contact = await tx.crmContact.create({
          data: {
            fullName: lead.leadName,
            email: lead.email,
            phone: lead.mobileNo,
            jobTitle: lead.jobTitle,
            organizationId,
            isPrimary: true,
          },
          select: { id: true },
        });
        resolvedContactId = contact.id;
      }
    }

    const deal = await tx.crmDeal.create({
      data: {
        dealName: (payload.dealName || lead.leadName).trim(),
        organizationId,
        contactId: resolvedContactId,
        leadId: lead.id,
        stageId: stage?.id ?? null,
        kind,
        value: expectedValue,
        probability: payload.probability ?? stage?.probability ?? 0,
        expectedCloseDate: toDate(payload.expectedCloseDate) ?? null,
        nextStep: payload.nextStep ?? null,
        dealOwnerId,
        closedAt: kind === "WON" || kind === "LOST" ? new Date() : null,
      },
      select: {
        id: true,
        dealName: true,
        value: true,
        currency: true,
        kind: true,
        probability: true,
        stageId: true,
        stage: { select: { id: true, label: true, color: true } },
        organizationId: true,
        contactId: true,
        leadId: true,
        dealOwnerId: true,
        expectedCloseDate: true,
        nextStep: true,
        createdAt: true,
      },
    });

    const updatedLead = await tx.crmLead.update({
      where: { id: lead.id },
      data: { status: "CONVERTED", convertedAt: new Date(), convertedDealId: deal.id, contactId: resolvedContactId },
      select: { id: true, leadName: true, status: true, convertedAt: true, convertedDealId: true, contactId: true },
    });

    if (payload.note) {
      await tx.crmCommunication.create({
        data: {
          type: "NOTE",
          content: payload.note,
          leadId: lead.id,
          dealId: deal.id,
          contactId: resolvedContactId,
          createdById: userId,
        },
      });
    }

    return { deal, lead: updatedLead };
  });

  await communicationService.logSystemEvent({
    leadId: lead.id,
    dealId: result.deal.id,
    contactId: result.deal.contactId,
    content: `Chuyển thành Deal: ${result.deal.dealName}`,
    createdById: userId,
  });

  await auditService.log({
    userId,
    action: "CONVERT_CRM_LEAD",
    entity: "CrmLead",
    entityId: lead.id,
    before: { status: lead.status },
    after: { status: "CONVERTED", dealId: result.deal.id, dealName: result.deal.dealName },
  });

  if (dealOwnerId && dealOwnerId !== userId) {
    await notif
      .createOne({
        type: "SYSTEM",
        severity: "INFO",
        title: "Deal mới được giao cho bạn",
        message: result.deal.dealName,
        link: `/crm/deals/${result.deal.id}`,
        userId: dealOwnerId,
        meta: { dealId: result.deal.id, leadId: lead.id },
      })
      .catch(() => null);
  }

  return result;
};

/**
 * Nhập nhiều lead 1 lần (Excel/CSV đã parse sẵn ở frontend).
 * Bỏ qua lead trùng `mobileNo` (hoặc `email` nếu không có SĐT) trong cùng tenant.
 * @param {Array<Object>} rows
 * @param {string} userId
 * @returns {{ created: Object[], skipped: Array<{ index: number, reason: string }>, total: number }}
 */
const importList = async (rows, userId) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApiError(400, "Danh sách lead rỗng");
  }

  // Lấy trùng trong DB một lần thay vì N query
  const phones = rows.map((r) => r.mobileNo).filter(Boolean);
  const emails = rows.map((r) => r.email).filter(Boolean);
  const [existingLeads, existingContacts] = await Promise.all([
    phones.length
      ? prisma.crmLead.findMany({ where: { OR: [{ mobileNo: { in: phones } }, ...(emails.length ? [{ email: { in: emails } }] : [])] }, select: { mobileNo: true, email: true } })
      : Promise.resolve([]),
    phones.length
      ? prisma.crmContact.findMany({ where: { OR: [{ phone: { in: phones } }, ...(emails.length ? [{ email: { in: emails } }] : [])] }, select: { phone: true, email: true } })
      : Promise.resolve([]),
  ]);

  const seenPhones = new Set(existingLeads.map((l) => l.mobileNo).filter(Boolean));
  const seenEmails = new Set(existingLeads.map((l) => l.email).filter(Boolean));
  // Lead trùng SĐT với một Contact đã có → cũng bỏ qua (tránh tạo trùng người)
  for (const c of existingContacts) {
    if (c.phone) seenPhones.add(c.phone);
    if (c.email) seenEmails.add(c.email);
  }

  const toCreate = [];
  const skipped = [];
  const localPhones = new Set();
  const localEmails = new Set();

  rows.forEach((row, index) => {
    const phone = row.mobileNo || null;
    const email = row.email || null;
    if (!phone && !email) {
      skipped.push({ index, reason: "Thiếu cả SĐT và email" });
      return;
    }
    // Kiểm SĐT và email ĐỘC LẬP. Trước đây chỉ check email khi thiếu SĐT, nhưng
    // unique index (`@@unique([email, tenantId])`) chặn email trùng ở MỌI dòng →
    // dòng có cả SĐT lẫn email trùng sẽ nổ P2002 và làm hỏng cả đợt import.
    if (phone && (seenPhones.has(phone) || localPhones.has(phone))) {
      skipped.push({ index, reason: `SĐT ${phone} đã tồn tại` });
      return;
    }
    if (email && (seenEmails.has(email) || localEmails.has(email))) {
      skipped.push({ index, reason: `Email ${email} đã tồn tại` });
      return;
    }
    if (phone) localPhones.add(phone);
    if (email) localEmails.add(email);

    toCreate.push({
      leadName: String(row.leadName || "").trim(),
      email,
      mobileNo: phone,
      jobTitle: row.jobTitle ?? null,
      source: row.source ?? "IMPORT",
      status: "NEW",
      stageId: row.stageId ?? null,
      leadOwnerId: row.leadOwnerId ?? userId,
      organizationId: row.organizationId ?? null,
      expectedValue: row.expectedValue ?? null,
      notes: row.notes ?? null,
    });
  });

  if (toCreate.length === 0) {
    return { createdCount: 0, skipped, total: rows.length };
  }

  // `skipDuplicates` GIỜ CÓ TÁC DỤNG: schema có `@@unique([mobileNo, tenantId])` +
  // `@@unique([email, tenantId])` (CRM audit H10). Trước đó không có @@unique nên
  // Postgres không có gì để conflict → mọi import song song đều tạo lead trùng.
  let created;
  try {
    created = await prisma.crmLead.createMany({ data: toCreate, skipDuplicates: true });
  } catch (e) {
    throw translateDuplicateLead(e) || e;
  }

  await auditService.log({
    userId,
    action: "IMPORT_CRM_LEADS",
    entity: "CrmLead",
    after: { requested: rows.length, created: created.count, skipped: skipped.length },
  });

  return { createdCount: created.count, skipped, total: rows.length };
};

/** Metadata cho form tạo/sửa + bộ lọc ở frontend */
const listFields = async (user) => {
  await stagesService.ensureDefaultStages();
  const owners = await prisma.user.findMany({
    where: { isActive: true, role: { in: ["ADMIN", "MANAGER", "CASHIER"] } },
    select: { id: true, fullName: true, role: true },
    orderBy: { fullName: "asc" },
  });
  const sources = await prisma.crmLead.findMany({
    where: { source: { not: null } },
    distinct: ["source"],
    select: { source: true },
    orderBy: { source: "asc" },
  });

  return {
    statuses: ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "DEAD"],
    stages: await stagesService.list("LEAD", { includeInactive: true }),
    sources: sources.map((s) => s.source).filter(Boolean),
    owners,
    overdueDays: OVERDUE_DAYS,
  };
};

module.exports = {
  LEAD_SELECT,
  OVERDUE_DAYS,
  list,
  getById,
  create,
  update,
  remove,
  changeStage,
  convertToDeal,
  importList,
  listFields,
};
