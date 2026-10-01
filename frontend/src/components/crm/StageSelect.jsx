/**
 * Frontend: src/components/crm/StageSelect.jsx — Select đổi giai đoạn (LEAD hoặc DEAL)
 *
 * Tổng quan:
 * - Gọi GET /crm/stages theo `entityType` (mỗi entity có bộ stage riêng —
 *   backend trả 400 nếu dùng nhầm stage của kanban kia).
 * - Option hiển thị dot màu stage + nhãn; option rỗng = bỏ giai đoạn.
 * - Logic tải nằm ở hook `hooks/useCrmStages.js` (tách riêng để không vi phạm
 *   eslint `react-refresh/only-export-components`).
 *
 * Props:
 *   value:        string | null — stageId hiện tại
 *   entityType:   "LEAD" | "DEAL"
 *   onChange:     (stageId: string | null) => void
 *   allowEmpty:   boolean — cho chọn "Chưa phân giai đoạn" (default true)
 *   disabled:     boolean
 *   placeholder:  string
 *   width:        number|string
 *   onLoaded:     (stages) => void — callback để page dùng lại danh sách stage
 *
 * Exports:
 *   StageSelect (default)
 */
import { useEffect } from "react";
import { Select, Spin } from "antd";
import { useTranslation } from "react-i18next";
import useStages from "../../hooks/useCrmStages";
import { UNASSIGNED_COLOR } from "./constants";

export default function StageSelect({
  value,
  entityType = "DEAL",
  onChange,
  allowEmpty = true,
  disabled = false,
  placeholder,
  width = 220,
  onLoaded,
}) {
  const { stages, loading } = useStages(entityType);
  const { t } = useTranslation();

  useEffect(() => {
    if (onLoaded && stages.length) onLoaded(stages);
  }, [stages, onLoaded]);

  const options = [
    ...(allowEmpty
      ? [{ value: "", label: t("crmPipeline.common.notAssigned"), dot: UNASSIGNED_COLOR }]
      : []),
    ...stages.map((s) => ({ value: s.id, label: s.label, dot: s.color || UNASSIGNED_COLOR })),
  ];

  // Backend nhận null (không phải chuỗi rỗng) để gỡ stage
  const handleChange = (v) => onChange(v || null);

  if (loading && !stages.length) {
    return (
      <Select
        style={{ width }}
        loading
        disabled
        placeholder={placeholder || t("crmPipeline.common.loadingStage")}
        suffixIcon={<Spin size="small" />}
      />
    );
  }

  return (
    <Select
      style={{ width }}
      value={value || (allowEmpty ? "" : undefined)}
      onChange={handleChange}
      disabled={disabled}
      placeholder={placeholder || t("crmPipeline.common.selectStage")}
      options={options}
      optionRender={(opt) => (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="crm-stage__dot" style={{ background: opt.data?.dot || UNASSIGNED_COLOR }} />
          {opt.label}
        </span>
      )}
    />
  );
}
