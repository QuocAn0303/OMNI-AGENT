'use strict';

/**
 * modules/partners/referral.service.js — Lượt giới thiệu của đối tác (PRM)
 *
 * ============================================================================
 * MỘT LƯỢT GIỚI THIỆU LÀ GÌ
 * Một dòng trong `partner_referrals`: đối tác X giới thiệu người Y (tên, SĐT), vào
 * ngày nào, và Y có thực sự thành khách mua hay không. Đây là đơn vị dữ liệu mà mọi
 * báo cáo đối tác đều gom từ đây.
 *
 * ============================================================================
 * VÌ SAO `customerId` LÀ KHOÁ MỀM
 * Khách hàng có thể bị xoá mềm. Lượt giới thiệu là chứng từ để tính hoa hồng và để
 * kiểm toán, nên không được biến mất theo khách. Xem giải thích dài trong
 * `prisma/schema.prisma`.
 *
 * ============================================================================
 * `converted` CHỈ CHUYỂN ĐÚNG MỘT LẦN
 * Cờ này được đặt tại DUY NHẤT một điểm: lúc khách tiềm năng chuyển thành khách mua
 * (xem `crm/deals.service.js`). Không suy đoán theo lịch — khách đăng ký nhưng
 * chưa mua thì vẫn là chưa chuyển đổi, đếm sai là sai số liệu hoa hồng.
 */

const prisma = require("../../config/prisma");
const logger = require("../../utils/logger");
const partnerService = require("./partner.service");
const { stripDiacritics } = require("../../utils/vietnamese");

const clampPage = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

const clampLimit = (v, def = 20, max = 100) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
};

const normPhone = (v) => {
  if (typeof v !== "string") return v || null;
  const t = v.trim();
  return t || null;
};

/** Mã lượt giới thiệu có trùng không. Ràng buộc duy nhất ở tầng DB, ở đây chỉ chặn lỗi hiển thị. */
const generateUniqueReferralCode = async (client = prisma) => {
  for (let i = 0; i < 5; i += 1) {
    const code = partnerService.genReferralCode();
    const dup = await client.partnerReferral.findFirst({ where: { referralCode: code }, select: { id: true } });
    if (!dup) return code;
  }
  throw { status: 500, message: "Không sinh được mã lượt giới thiệu — thử lại sau" };
};

const list = async ({ page = 1, limit = 20, partnerId, converted, search } = {}) => {
  const p = clampPage(page);
  const l = clampLimit(limit);
  const where = {};
  if (partnerId) where.partnerId = partnerId;
  if (converted !== undefined && converted !== null && converted !== "") {
    where.converted = String(converted) === "true";
  }
  if (search) {
    where.OR = [
      { referredName: { contains: search, mode: "insensitive" } },
      { referredPhone: { contains: search, mode: "insensitive" } },
      { referralCode: { contains: search, mode: "insensitive" } },
    ];
  }
  const skip = (p - 1) * l;
  const [items, total] = await Promise.all([
    prisma.partnerReferral.findMany({
      where,
      skip,
      take: l,
      orderBy: { referralDate: "desc" },
      include: {
        partner: { select: { id: true, code: true, name: true, type: true, isActive: true } },
      },
    }),
    prisma.partnerReferral.count({ where }),
  ]);
  return {
    referrals: items,
    pagination: {
      page: p,
      limit: l,
      total,
      totalPages: Math.ceil(total / l),
    },
  };
};

const getById = async (id) => {
  const referral = await prisma.partnerReferral.findUnique({
    where: { id },
    include: {
      partner: { select: { id: true, code: true, name: true, type: true } },
    },
  });
  if (!referral) throw { status: 404, message: "Không tìm thấy lượt giới thiệu" };
  return referral;
};

/**
 * Ghi nhận một lượt giới thiệu.
 *
 * Lỗi trùng số điện thoại trong cùng đối tác được chặn ở TẦNG DB bằng ràng buộc
 * `@@unique([partnerId, referredPhone])`. Ở đây ta bắt lỗi của Prisma (mã P2002)
 * và đổi thành thông điệp dễ hiểu, vì khi đối tác gửi lại form mà SĐT đã có thì
 * báo lỗi kỹ thuật là vô ích.
 */
const create = async (data, userId = null) => {
  const partner = await prisma.partner.findUnique({ where: { id: data.partnerId }, select: { id: true } });
  if (!partner) throw { status: 404, message: "Không tìm thấy đối tác" };

  const referralCode = await generateUniqueReferralCode();
  try {
    const referral = await prisma.partnerReferral.create({
      data: {
        partnerId: data.partnerId,
        leadId: data.leadId || null,
        customerId: data.customerId || null,
        referralCode,
        referredName: data.referredName.trim(),
        referredPhone: data.referredPhone || null,
        referredEmail: data.referredEmail || null,
        referralDate: data.referralDate ? new Date(data.referralDate) : new Date(),
        converted: Boolean(data.converted),
        convertedAt: data.converted ? new Date() : null,
        sourceSnapshot: data.sourceSnapshot || null,
      },
    });
    logger.info(`[prm] ghi nhận lượt giới thiệu ${referralCode} cho đối tác ${data.partnerId} (bởi ${userId || "hệ thống"})`);
    return referral;
  } catch (e) {
    if (e.code === "P2002") {
      throw {
        status: 409,
        message: "Số điện thoại này đã được đối tác giới thiệu trước đó — không ghi nhận trùng",
      };
    }
    throw e;
  }
};

/**
 * Gắn lượt giới thiệu vào khách vừa tạo từ lead.
 *
 * Gọi từ `crm/lead-capture.service.js` khi webhook nhận lead có kèm mã đối tác.
 * Nếu SĐT đã có lượt giới thiệu của đúng đối tác đó thì bỏ qua chứ không lỗi —
 * vì đối tác gửi lại cùng một khách là chuyện thường, không phải sự cố.
 */
const attachToLead = async ({ partnerCode, lead, customerId = null }) => {
  const partner = await partnerService.findActiveByCode(partnerCode);
  if (!partner) {
    logger.warn(`[prm] mã đối tác không hợp lệ hoặc đã ngừng: ${partnerCode}`);
    return null;
  }
  // NULL-phone: Postgres coi NULL là phân biệt trong @@unique nên DB cho nhiều
  // dòng NULL-phone, nhưng findFirst({ referredPhone: null }) lại khớp BẤT KỲ dòng
  // NULL nào của đối tác → hai lead không SĐT sẽ gắn nhầm vào nhau và markConverted
  // tính hoa hồng sai dòng. Chỉ dedupe khi có SĐT thật, không thì luôn tạo mới.
  const phone = normPhone(lead.mobileNo);
  let existing = null;
  if (phone) {
    existing = await prisma.partnerReferral.findFirst({
      where: { partnerId: partner.id, referredPhone: phone },
      select: { id: true, referralCode: true, converted: true, leadId: true, customerId: true },
    });
  }
  if (existing) {
    // Dòng đã tồn tại nhưng CHƯA gắn lead ⇒ phải gắn bổ sung, không phải bỏ qua.
    //
    // Đây là tình huống rất dễ xảy ra và rất nguy hiểm nếu bỏ qua: nhân viên nhập tay
    // lượt giới thiệu cho khách gọi điện (không qua webhook), rồi khách đó lại gửi
    // form có mã đối tác trên web. Lần webhook phát hiện trùng số, trả về dòng cũ
    // — dòng cũ có `leadId = NULL` ⇒ `markConverted(leadId)` về sau không tìm thấy
    // dòng nào ⇒ lượt giới thiệu KHÔNG BAO GIỜ được đánh dấu chuyển đổi ⇒ đối tác
    // mất hoa hồng một cách âm thầm, và báo cáo phễu hiện tỷ lệ chuyển đổi 0.
    //
    // Nếu đã gắn lead rồi thì mới là trùng thật, bỏ qua là đúng.
    if (lead.id && !existing.leadId) {
      const patch = { leadId: lead.id };
      // Gặp khách trước rồi mới có lead (nhập tay kèm mã khách) → ghi luôn chiều ngược.
      if (!existing.customerId && customerId) patch.customerId = customerId;
      const updated = await prisma.partnerReferral.update({
        where: { id: existing.id },
        data: patch,
        select: { id: true, referralCode: true, converted: true, leadId: true, customerId: true },
      });
      logger.info(
        `[prm] lượt giới thiệu ${existing.referralCode} đã có sẵn — gắn bổ sung lead ${lead.id} ` +
          `thay vì tạo dòng mới (nếu bỏ qua, lượt này sẽ không bao giờ được đánh dấu chuyển đổi)`,
      );
      return updated;
    }
    logger.info(`[prm] lượt giới thiệu đã tồn tại ${existing.referralCode} - bỏ qua, không tạo trùng`);
    return existing;
  }
  const referralCode = await generateUniqueReferralCode();
  try {
    const referral = await prisma.partnerReferral.create({
      data: {
        partnerId: partner.id,
        leadId: lead.id,
        customerId,
        referralCode,
        referredName: lead.leadName,
        referredPhone: phone,
        referredEmail: lead.email || null,
        sourceSnapshot: partner.code,
      },
    });
    logger.info(`[prm] lead ${lead.id} gắn vào đối tác ${partner.code}, mã ${referralCode}`);
    return referral;
  } catch (e) {
    if (e.code === "P2002") return null; // đối tác gửi song song — ràng buộc DB đã chặn
    throw e;
  }
};

/**
 * Đánh dấu lượt giới thiệu đã chuyển đổi thành khách mua.
 *
 * Chỉ đánh dấu lần đầu. Nếu đã `true` rồi thì giữ nguyên `convertedAt` cũ, vì đó là
 * mốc thời gian doanh nghiệp bắt đầu được hưởng hoa hồng cho lượt giới thiệu đó.
 */
const markConverted = async (leadId, customerId, client = prisma) => {
  const rows = await client.partnerReferral.findMany({
    where: { leadId, converted: false },
    select: { id: true },
  });
  if (!rows.length) return { updated: 0 };
  const now = new Date();
  await client.partnerReferral.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { converted: true, convertedAt: now, customerId },
  });
  // Ghi thêm `customerId` vào bảng khách hàng để tra cứu ngược một chiều được mà
  // không phải quét bảng lượt giới thiệu.
  if (customerId) {
    await client.customer
      .update({ where: { id: customerId }, data: { partnerReferralId: rows[0].id } })
      .catch((e) => logger.warn("[prm] ghi partnerReferralId lên khách thất bại:", { err: e, customerId }));
  }
  logger.info(`[prm] đánh dấu chuyển đổi ${rows.length} lượt giới thiệu của lead ${leadId}`);
  return { updated: rows.length };
};

/**
 * Phễu chuyển đổi theo từng đối tác.
 *
 * Bốn mốc lấy nguyên văn từ enum `CrmLeadStatus` trong `prisma/schema.prisma`:
 *   NEW → CONTACTED → QUALIFIED → CONVERTED,  cộng nhánh DEAD.
 *
 * Mốc cuối là `CONVERTED`, KHÔNG phải `CUSTOMER`. `CUSTOMER` là giá trị của enum
 * khác (`LeadStatus`) và không tồn tại trong `CrmLeadStatus`. Trước đây phễu ghi
 * "CUSTOMER" nên `stages["CUSTOMER"]` luôn là `undefined` và cột cuối LUÔN bằng 0 —
 * mọi đối tác đều hiện 0 khách chuyển đổi trong phễu dù họ có thật.
 * `tests/partner-referral.service.test.js` có test chốt giá trị này với enum thật.
 *
 * Các mốc đếm TRẠNG THÁI HIỆN TẠI của lead, nên một lead đã chuyển qua cả ba mốc
 * sẽ được tính ở cả ba — đó là phễu theo trạng thái, không phải hành trình. Muốn
 * hành trình thì phải dựng bảng chuyển trạng thái theo thời gian, ngoài phạm vi.
 */
const FUNNEL_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED"];

const funnel = async ({ partnerId } = {}) => {
  const where = partnerId ? { partnerId } : {};
  const partners = await prisma.partner.findMany({
    where,
    select: { id: true, code: true, name: true, type: true, isActive: true },
    orderBy: { name: "asc" },
  });
  const ids = partners.map((p) => p.id);

  // Gom số lượt giới thiệu theo đối tác một lần rồi chia nhánh, thay vì gọi count
  // riêng cho từng đối tác (N+1).
  const grouped = await prisma.partnerReferral.groupBy({
    by: ["partnerId", "converted"],
    where: { partnerId: { in: ids.length ? ids : ["__none__"] } },
    _count: { _all: true },
  });
  const counts = new Map();
  for (const g of grouped) {
    const key = g.partnerId;
    if (!counts.has(key)) counts.set(key, { total: 0, converted: 0 });
    const slot = counts.get(key);
    slot.total += g._count._all;
    if (g.converted) slot.converted += g._count._all;
  }

  // Trạng thái lead theo đối tác: dùng sourceSnapshot chứa mã đối tác làm khoá nối,
  // vì `partner_referrals.leadId` có thể NULL (lượt nhập tay không qua webhook).
  // So khớp KHÔNG phân biệt hoa/dấu: bàn phím không gõ được `ĐT` nên webhook hay
  // gửi `dt-202610-0001`. So khớp byte-chính-xác làm phễu đếm thiếu. Chuẩn hoá cả
  // hai vế bằng stripDiacritics + UPPER, và truy vấn đủ biến thể thường gặp để
  // không phải quét toàn bảng lead.
  const normCode = (s) => stripDiacritics(String(s || "")).toUpperCase().trim();
  const byNorm = new Map(partners.map((p) => [normCode(p.code), p]));
  const queryCodes = [
    ...new Set(
      partners.flatMap((p) => [
        p.code,
        p.code.toLowerCase(),
        p.code.toUpperCase(),
        stripDiacritics(p.code),
        stripDiacritics(p.code).toLowerCase(),
        stripDiacritics(p.code).toUpperCase(),
      ]),
    ),
  ];
  const leadRows = await prisma.crmLead.findMany({
    where: { source: { in: partners.length ? queryCodes : ["__none__"] } },
    select: { source: true, status: true },
  });
  const stageCounts = new Map();
  for (const r of leadRows) {
    const key = byNorm.get(normCode(r.source))?.code || r.source;
    if (!stageCounts.has(key)) stageCounts.set(key, {});
    const slot = stageCounts.get(key);
    slot[r.status] = (slot[r.status] || 0) + 1;
  }

  return partners.map((p) => {
    const c = counts.get(p.id) || { total: 0, converted: 0 };
    const stages = stageCounts.get(p.code) || {};
    const dead = stages.DEAD || 0;
    return {
      partnerId: p.id,
      code: p.code,
      name: p.name,
      type: p.type,
      isActive: p.isActive,
      referrals: c.total,
      converted: c.converted,
      conversionRate: c.total ? Number(((c.converted / c.total) * 100).toFixed(2)) : 0,
      funnel: FUNNEL_STAGES.map((s) => ({ stage: s, count: stages[s] || 0 })),
      dead,
    };
  });
};

module.exports = {
  FUNNEL_STAGES,
  generateUniqueReferralCode,
  list,
  getById,
  create,
  attachToLead,
  markConverted,
  funnel,
};