/**
 * Frontend: src/components/crm/StageTag.jsx — Badge hiển thị giai đoạn pipeline
 *
 * Tổng quan:
 * - Dùng ở table/list: hiển thị stage của lead/deal bằng dot màu + nhãn.
 * - `stage.label` là nhãn do ADMIN tự đặt trong Pipeline Settings → hiển thị
 *   nguyên văn (không dịch, vì đây là dữ liệu người dùng).
 * - Stage có thể `null` (chưa phân giai đoạn) → hiện nhãn của `status` nếu có,
 *   không thì "Chưa phân giai đoạn".
 *
 * Props:
 *   stage:  { id, label, color, kind } | null
 *   status: string — enum status của lead (dùng khi chưa gán stage)
 *
 * Exports:
 *   StageTag (default)
 */
import { useTranslation } from "react-i18next";
import { leadStatusLabel, UNASSIGNED_COLOR } from "./constants";

export default function StageTag({ stage, status }) {
  const { t } = useTranslation();

  if (!stage) {
    return (
      <span className="crm-stage" style={{ color: "var(--text-muted)" }}>
        <span className="crm-stage__dot" style={{ background: UNASSIGNED_COLOR }} />
        {leadStatusLabel(t, status) || t("crmPipeline.common.notAssigned")}
      </span>
    );
  }

  return (
    <span className="crm-stage">
      <span className="crm-stage__dot" style={{ background: stage.color || UNASSIGNED_COLOR }} />
      {stage.label}
    </span>
  );
}
