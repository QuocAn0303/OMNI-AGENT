/**
 * Frontend: src/components/partners/constants.js — Nhãn + helper dùng chung PRM
 *
 * Tổng quan:
 * - Nhãn tiếng Việt cho enum của backend (`prisma/schema.prisma`): `PartnerType` và
 *   `CommissionType`. Bảng meta chỉ chứa `labelKey` + `color`; component gọi qua `t`
 *   của react-i18next, KHÔNG hardcode tiếng Việt trong JSX.
 * - `PARTNER_FUNNEL_STAGES` phải khớp `referral.service.js::FUNNEL_STAGES` — đổi một
 *   bên mà quên bên kia thì bảng phễu hiển thị thiếu cột mà không báo lỗi.
 *
 * Exports:
 * - PARTNER_TYPE_META, COMMISSION_TYPE_META
 * - partnerTypeLabel/Options, commissionTypeLabel/Options
 * - FUNNEL_STAGE_META, funnelStageLabel, percentOf
 */
import {
  TeamOutlined, GlobalOutlined, UserSwitchOutlined, UserOutlined,
  PercentageOutlined, DollarOutlined,
} from "@ant-design/icons";

/** Loại đối tác — xem `PartnerType` trong schema.prisma */
export const PARTNER_TYPE_META = {
  AFFILIATE: { labelKey: "prm.type.AFFILIATE", color: "blue", icon: TeamOutlined },
  MARKETING_CHANNEL: { labelKey: "prm.type.MARKETING_CHANNEL", color: "purple", icon: GlobalOutlined },
  REFERRER: { labelKey: "prm.type.REFERRER", color: "green", icon: UserSwitchOutlined },
  SALES_AGENT: { labelKey: "prm.type.SALES_AGENT", color: "orange", icon: UserOutlined },
};

/**
 * Cách tính hoa hồng — xem `CommissionType`.
 *
 * Hai cách cùng tồn tại vì chương trình giới thiệu ở Việt Nam phần lớn trả theo
 * LẦN GIỚI THIỆU, không theo tỷ lệ doanh thu.
 */
export const COMMISSION_TYPE_META = {
  PERCENT_OF_CLV: { labelKey: "prm.commissionType.PERCENT_OF_CLV", icon: PercentageOutlined },
  FIXED_PER_CUSTOMER: { labelKey: "prm.commissionType.FIXED_PER_CUSTOMER", icon: DollarOutlined },
};

/**
 * Bốn mốc phễu chuyển đổi.
 *
 * Lưu ý về nghĩa: đây là phễu THEO TRẠNG THÁI HIỆN TẠI của lead, không phải hành
 * trình. Một lead đã đi qua cả ba mốc vẫn được tính ở cả ba. Muốn hành trình thì
 * phải dựng bảng chuyển trạng thái theo thời gian, ngoài phạm vi đồ án.
 *
 * Key PHẢI khớp nguyên văn enum `CrmLeadStatus` trong `prisma/schema.prisma` và mảng
 * `FUNNEL_STAGES` trong `referral.service.js`. Mốc cuối là `CONVERTED`, không phải
 * `CUSTOMER`: `CUSTOMER` thuộc enum khác (`LeadStatus`) và không tồn tại trong
 * `CrmLeadStatus`, nên tra cứu sẽ ra `undefined` và cột cuối hiện 0% ở mọi đối tác.
 * Nhãn hiển thị thì dịch `CONVERTED` thành "Thành khách" vì đó là cách nói với
 * người dùng; tên trường là tên của hệ thống.
 */
export const FUNNEL_STAGE_META = {
  NEW: { labelKey: "prm.funnel.NEW", color: "default" },
  CONTACTED: { labelKey: "prm.funnel.CONTACTED", color: "processing" },
  QUALIFIED: { labelKey: "prm.funnel.QUALIFIED", color: "cyan" },
  CONVERTED: { labelKey: "prm.funnel.CONVERTED", color: "success" },
};

export const FUNNEL_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED"];

/** Nhánh lead bị loại — tính riêng, không nằm trong phễu chính. */
export const DEAD_LABEL_KEY = "prm.funnel.DEAD";

export const partnerTypeLabel = (t) => (type) =>
  t(PARTNER_TYPE_META[type]?.labelKey || "prm.type.AFFILIATE");

export const partnerTypeOptions = (t) =>
  Object.entries(PARTNER_TYPE_META).map(([value, meta]) => ({
    value,
    label: t(meta.labelKey),
  }));

export const commissionTypeOptions = (t) =>
  Object.entries(COMMISSION_TYPE_META).map(([value, meta]) => ({
    value,
    label: t(meta.labelKey),
  }));

export const funnelStageLabel = (t) => (stage) =>
  t(FUNNEL_STAGE_META[stage]?.labelKey || "prm.funnel.NEW");

/**
 * Tỷ lệ phần trăm an toàn.
 *
 * Trả "—" thay vì 0 khi mẫu số bằng 0, vì "0%" đọc là "không có ai chuyển đổi"
 * trong khi thật ra là "chưa có lượt giới thiệu nào để đo".
 */
export const percentOf = (part, whole) => {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 10000) / 100}%`;
};

/**
 * Mô tả cách tính hoa hồng của một đối tác, dạng ngắn để hiện trong bảng.
 * `commissionPercent` đã là phần trăm do backend quy đổi sẵn.
 */
export const commissionLabel = (t) => (p) =>
  p.commissionType === "FIXED_PER_CUSTOMER"
    ? `${Number(p.fixedCommission || 0).toLocaleString("vi-VN")}₫ / ${t("prm.perCustomer")}`
    : `${p.commissionPercent}%`;