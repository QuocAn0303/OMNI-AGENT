/**
 * Frontend: src/components/crm/constants.js — Hằng số + helper dùng chung CRM Pipeline
 *
 * Tổng quan:
 * - Nhãn tiếng Việt cho enum của backend (`crm.pipeline.validation.js`).
 *   Backend trả enum thô (NEW/CONVERTED/...), FE map sang nhãn qua i18n key
 *   `crmPipeline.*` (xem locales/vi.json + en.json).
 * - Bảng meta chỉ chứa `labelKey` + `color`; component gọi qua các hàm helper
 *   nhận `t` của react-i18next để không hardcode tiếng Việt trong JSX.
 * - `kind` của stage quyết định ngữ nghĩa kanban: ONGOING / WON / LOST.
 *
 * Exports:
 * - LEAD_STATUS_META, DEAL_KIND_META, STAGE_KIND_META, COMM_TYPE_META
 * - leadStatusLabel/Options, dealKindLabel/Options, commTypeOptions
 * - stageDotColor, kindOfStage, shortMoney
 */
import {
  ThunderboltOutlined, MessageOutlined, PhoneOutlined, MailOutlined,
  CalendarOutlined, CommentOutlined, WhatsAppOutlined, ApiOutlined,
  CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined,
} from "@ant-design/icons";

/** status của CrmLead — màu theo ngữ nghĩa tiến trình bán hàng */
export const LEAD_STATUS_META = {
  NEW: { labelKey: "crmPipeline.status.NEW", color: "default" },
  CONTACTED: { labelKey: "crmPipeline.status.CONTACTED", color: "processing" },
  QUALIFIED: { labelKey: "crmPipeline.status.QUALIFIED", color: "success" },
  CONVERTED: { labelKey: "crmPipeline.status.CONVERTED", color: "purple" },
  DEAD: { labelKey: "crmPipeline.status.DEAD", color: "error" },
};

/** kind của CrmDeal (denormalize từ stage) */
export const DEAL_KIND_META = {
  ONGOING: { labelKey: "crmPipeline.kind.ONGOING", color: "processing" },
  WON: { labelKey: "crmPipeline.kind.WON", color: "success" },
  LOST: { labelKey: "crmPipeline.kind.LOST", color: "error" },
};

/** kind của CrmPipelineStage — quyết định cách FE render cột kanban */
export const STAGE_KIND_META = {
  ONGOING: { labelKey: "crmPipeline.kind.ONGOING", color: "#0f766e" },
  WON: { labelKey: "crmPipeline.kind.WON", color: "#16a34a" },
  LOST: { labelKey: "crmPipeline.kind.LOST", color: "#dc2626" },
};

/** CrmCommType — icon + màu cho unified timeline */
export const COMM_TYPE_META = {
  NOTE: { labelKey: "crmPipeline.comm.NOTE", icon: <CommentOutlined />, color: "#64748b" },
  CALL: { labelKey: "crmPipeline.comm.CALL", icon: <PhoneOutlined />, color: "#0284c7" },
  EMAIL: { labelKey: "crmPipeline.comm.EMAIL", icon: <MailOutlined />, color: "#7c3aed" },
  MEETING: { labelKey: "crmPipeline.comm.MEETING", icon: <CalendarOutlined />, color: "#c2410c" },
  ZALO: { labelKey: "crmPipeline.comm.ZALO", icon: <ThunderboltOutlined />, color: "#0d9488" },
  WHATSAPP: { labelKey: "crmPipeline.comm.WHATSAPP", icon: <WhatsAppOutlined />, color: "#059669" },
  SYSTEM: { labelKey: "crmPipeline.comm.SYSTEM", icon: <ApiOutlined />, color: "#94a3b8" },
};

/** Nhãn fallback khi backend không trả i18n key hợp lệ (chống render raw key) */
const FALLBACK = {
  status: { NEW: "Mới", CONTACTED: "Đã liên hệ", QUALIFIED: "Đủ thông tin", CONVERTED: "Đã chuyển Deal", DEAD: "Thất bại" },
  kind: { ONGOING: "Đang chạy", WON: "Thắng", LOST: "Thua" },
  comm: { NOTE: "Ghi chú", CALL: "Cuộc gọi", EMAIL: "Email", MEETING: "Họp", ZALO: "Zalo", WHATSAPP: "WhatsApp", SYSTEM: "Hệ thống" },
};

const translate = (t, key, fallbackMap, value) => {
  const label = t(key, { defaultValue: "" });
  if (label && label !== key) return label;
  return fallbackMap[value] || value;
};

// ==================== Helper dùng chung (nhận `t`) ====================

export const leadStatusLabel = (t, v) =>
  v ? translate(t, LEAD_STATUS_META[v]?.labelKey || "", FALLBACK.status, v) : null;

export const leadStatusOptions = (t) =>
  Object.entries(LEAD_STATUS_META).map(([value, m]) => ({ value, label: translate(t, m.labelKey, FALLBACK.status, value) }));

export const dealKindLabel = (t, v) =>
  v ? translate(t, DEAL_KIND_META[v]?.labelKey || "", FALLBACK.kind, v) : null;

export const dealKindOptions = (t) =>
  Object.entries(DEAL_KIND_META).map(([value, m]) => ({ value, label: translate(t, m.labelKey, FALLBACK.kind, value) }));

/** Các loại user được tự tạo trong timeline (SYSTEM do backend sinh, không chọn được) */
export const COMM_TYPE_WRITABLE = ["NOTE", "CALL", "EMAIL", "MEETING", "ZALO", "WHATSAPP"];

export const commTypeOptions = (t) =>
  COMM_TYPE_WRITABLE.map((v) => ({ value: v, label: translate(t, COMM_TYPE_META[v].labelKey, FALLBACK.comm, v) }));

/** Màu dot của stage — fallback khi stage null (deal chưa phân giai đoạn) */
export const UNASSIGNED_COLOR = "#64748b";

/**
 * `CrmPipelineStage.id` có thể `null` (cột tổng hợp "Chưa phân giai đoạn" do
 * `dealsService.getBoard` sinh), nhưng `@hello-pangea/dnd` bắt buộc
 * `droppableId` là **string** → dùng key sentinel này.
 */
export const UNASSIGNED_KEY = "__unassigned__";
export const colKey = (id) => (id ? String(id) : UNASSIGNED_KEY);

export const kindOfStage = (stage) =>
  (stage && STAGE_KIND_META[stage.kind] ? stage.kind : "ONGOING");

export const stageDotColor = (stage) =>
  (stage && stage.color) || STAGE_KIND_META[kindOfStage(stage)].color;

export const STAGE_ICON = {
  WON: <CheckCircleOutlined />,
  LOST: <CloseCircleOutlined />,
  ONGOING: <ClockCircleOutlined />,
};

/** Rút tiền ngắn cho header cột kanban: 125.000.000 → "125tr" */
export const shortMoney = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(v % 1e9 === 0 ? 0 : 1)}t`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1)}tr`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return String(Math.round(v));
};
