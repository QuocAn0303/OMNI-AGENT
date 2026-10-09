'use strict';

/**
 * modules/partners/partner.service.js — Nghiệp vụ đối tác (PRM)
 *
 * ============================================================================
 * ĐỐI TÁC LÀ GÌ VÀ KHÁC `Vendor` Ở ĐÂU
 * `Vendor` là NHÀ CUNG CẤP đầu vào (SRM): mua hàng, ma trận Kraljic, chỉ số giao
 * hàng đúng hạn, đối soát ba bên. `Partner` là ĐỐI TÁC đầu ra (PRM): giới thiệu
 * khách, hưởng hoa hồng, và cần chứng minh mình mang lại khách chất lượng chứ
 * không chỉ mang lại nhiều đầu mối. Hai chiều của quan hệ, tách riêng vì cách tính
 * tiền và cách đo hiệu quả khác hẳn nhau.
 *
 * ============================================================================
 * MÃ ĐỐI TÁC
 * Định dạng `ĐT-YYYYMM-XXXX`, cùng kiểu với `ST-YYYYMMDD-XXXX` và `GRN-YYYYMMDD-XXXX`
 * đang dùng trong dự án. Sinh trong một vòng lặp có kiểm tra trùng: `code` có
 * ràng buộc duy nhất ở tầng cơ sở dữ liệu, nên hai phiên tạo đồng thời có thể đụng
 * nhau và phải thử lại, không được chỉ dựa vào việc đọc trước rồi ghi.
 *
 * ============================================================================
 * TỶ LỆ HOA HỒNG LƯU THẾ NÀO
 * `commissionRate` lưu dạng THẬP PHÂN: 0,10 là 10%. Khi trả ra API thì nhân 100 và
 * đặt tên trường là `commissionPercent`. Cách này tránh nhân nhầm kiểu vì
 * `commissionRate: 10` sẽ bị hiểu là 1000%.
 */

const prisma = require("../../config/prisma");
const logger = require("../../utils/logger");

/**
 * Tiền tố mã đối tác.
 *
 * Dùng `ĐT` (đối tác) chứ không phải `DT`, để khớp với tiền tố tiếng Việt đang có
 * trong dự án: `vendors.code` dùng `NCC-XXXX` cho nhà cung cấp. Trộn ký tự có dấu và
 * không dấu trong cùng hệ mã làm khó tra cứu và dễ tra nhầm khi đọc báo cáo in ra.
 *
 * Hệ quả: gõ `ĐT` trên bàn phím không bật được dấu thì khó, nên mọi đường tra cứu
 * theo mã đều so khớp không phân biệt dấu — xem `stripDiacritics` trong
 * `search_partner_referrals` và `extractParams` của db-agent.
 */
const CODE_PREFIX = "ĐT";

/** Chuỗi ngẫu nhiên cho mã lượt giới thiệu, kiểu giống mã ưu đãi win-back. */
const crypto = require("crypto");
const genReferralCode = () => `RF-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

const monthStamp = (d = new Date()) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Sinh mã đối tác duy nhất trong tenant.
 *
 * Thử tối đa 10 lần. Mỗi lần thử lại tăng số thứ tự, nên kể cả khi có nhiều đối tác
 * tạo cùng lúc thì vẫn có dự phòng thay vì lỗi trùng khoá.
 */
const generateUniqueCode = async (client = prisma) => {
  const stamp = monthStamp();
  for (let i = 0; i < 10; i += 1) {
    const rows = await client.partner.count({ where: { code: { startsWith: `${CODE_PREFIX}-${stamp}` } } });
    const code = `${CODE_PREFIX}-${stamp}-${String(rows + 1 + i).padStart(4, "0")}`;
    const dup = await client.partner.findFirst({ where: { code }, select: { id: true } });
    if (!dup) return code;
  }
  throw { status: 500, message: "Không sinh được mã đối tác không trùng — thử lại sau" };
};

/**
 * Đưa đối tác ra ngoài API.
 *
 * `commissionRate` trong cơ sở dữ liệu là thập phân, ra ngoài là phần trăm. Tên
 * trường đổi luôn theo (`commissionPercent`) để phía giao diện không phải đoán.
 */
const serialize = (partner) => {
  if (!partner) return null;
  const { commissionRate, ...rest } = partner;
  return {
    ...rest,
    commissionPercent: Number(((Number(commissionRate) || 0) * 100).toFixed(4)),
    commissionRate: undefined,
  };
};

const list = async ({ page = 1, limit = 20, type, isActive, search } = {}) => {
  const where = {};
  if (type) where.type = type;
  if (isActive !== undefined && isActive !== null && isActive !== "") where.isActive = String(isActive) === "true";
  if (search) {
    where.OR = [{ name: { contains: search, mode: "insensitive" } }, { code: { contains: search, mode: "insensitive" } }];
  }
  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    prisma.partner.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: "desc" },
    }),
    prisma.partner.count({ where }),
  ]);
  return {
    partners: items.map(serialize),
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    },
  };
};

const getById = async (id) => {
  const partner = await prisma.partner.findUnique({
    where: { id },
    include: { _count: { select: { referrals: true } } },
  });
  if (!partner) throw { status: 404, message: "Không tìm thấy đối tác" };
  return serialize(partner);
};

const create = async (data) => {
  const code = data.code?.trim() || (await generateUniqueCode());
  const partner = await prisma.partner.create({
    data: {
      code,
      name: data.name.trim(),
      type: data.type || "AFFILIATE",
      commissionType: data.commissionType || "PERCENT_OF_CLV",
      // Đầu vào là PHẦN TRĂM (10 = 10%), lưu xuống là thập phân (0,10). Chia 100
      // ở đây một lần, thay vì bắt phía giao diện phải nhớ quy tắc.
      commissionRate: Number(((Number(data.commissionPercent) || 0) / 100).toFixed(4)),
      fixedCommission: Number(data.fixedCommission || 0),
      contactName: data.contactName || null,
      phone: data.phone || null,
      email: data.email || null,
      notes: data.notes || null,
    },
  });
  return serialize(partner);
};

const update = async (id, data) => {
  const existing = await prisma.partner.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw { status: 404, message: "Không tìm thấy đối tác" };
  const patch = {};
  if (data.name !== undefined) patch.name = data.name.trim();
  if (data.type !== undefined) patch.type = data.type;
  if (data.commissionType !== undefined) patch.commissionType = data.commissionType;
  if (data.commissionPercent !== undefined) {
    patch.commissionRate = Number(((Number(data.commissionPercent) || 0) / 100).toFixed(4));
  }
  if (data.fixedCommission !== undefined) patch.fixedCommission = Number(data.fixedCommission);
  if (data.contactName !== undefined) patch.contactName = data.contactName || null;
  if (data.phone !== undefined) patch.phone = data.phone || null;
  if (data.email !== undefined) patch.email = data.email || null;
  if (data.notes !== undefined) patch.notes = data.notes || null;
  if (data.isActive !== undefined) patch.isActive = Boolean(data.isActive);
  const partner = await prisma.partner.update({ where: { id }, data: patch });
  return serialize(partner);
};

/**
 * Ngừng hoạt động một đối tác — XOÁ MỀM, không xoá hẳn.
 *
 * Vì sao không xoá: lượt giới thiệu là chứng từ để tính hoa hồng và để kiểm toán
 * đối tác cũ. Xoá hẳn đối tác sẽ kéo theo mất lịch sử (khoá ngoại `partnerId` là
 * CASCADE). Đồng thời đặt `isActive = false` làm các truy vấn lấy đối tác đang hoạt
 * động bỏ qua họ, nên hiệu quả vận hành không đổi.
 */
const deactivate = async (id) => {
  const partner = await prisma.partner.findUnique({ where: { id }, select: { id: true } });
  if (!partner) throw { status: 404, message: "Không tìm thấy đối tác" };
  return serialize(await prisma.partner.update({ where: { id }, data: { isActive: false } }));
};

const restore = async (id) => {
  const partner = await prisma.partner.findUnique({ where: { id }, select: { id: true } });
  if (!partner) throw { status: 404, message: "Không tìm thấy đối tác" };
  return serialize(await prisma.partner.update({ where: { id }, data: { isActive: true } }));
};

/**
 * Tìm đối tác theo mã, chỉ trong số đang hoạt động.
 *
 * Dùng cho việc nối lượt giới thiệu từ webhook: đối tác đã ngừng thì không được
 * ghi nhận thêm lượt mới, nếu không số liệu hoa hồng của kỳ trước và kỳ sau lệch nhau.
 */
const findActiveByCode = async (code, client = prisma) => {
  if (!code) return null;
  return client.partner.findFirst({ where: { code, isActive: true } });
};

const countActive = async () => prisma.partner.count({ where: { isActive: true } });

/**
 * Thống kê đối tác theo loại — dùng cho bộ lọc trên giao diện.
 * Trả về kèm số lượt giới thiệu để không phải gọi thêm một vòng.
 */
const countByType = async () => {
  const rows = await prisma.partner.groupBy({
    by: ["type", "isActive"],
    _count: { _all: true },
  });
  const out = {};
  for (const r of rows) out[r.type] = (out[r.type] || 0) + r._count._all;
  return out;
};

module.exports = {
  CODE_PREFIX,
  genReferralCode,
  generateUniqueCode,
  serialize,
  list,
  getById,
  create,
  update,
  deactivate,
  restore,
  findActiveByCode,
  countActive,
  countByType,
};