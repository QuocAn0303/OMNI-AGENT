/**
 * Frontend: src/hooks/useCrmStages.js — Hook tải + cache giai đoạn pipeline
 *
 * Tổng quan:
 * - `CrmPipelineStage` là bảng cấu hình, mỗi entityType (LEAD/DEAL) một bộ riêng.
 *   Hook tải theo `entityType` và chuyển `stageId` ↔ nhãn/màu ở mọi nơi.
 * - Lần gọi `GET /crm/stages` đầu tiên của tenant sẽ lazy-seed 9 stage mặc định
 *   (xem `stages.service.js:ensureDefaultStages`) → không cần tạo sẵn ở seed.
 * - `loading` được **suy ra** từ việc response đã khớp `key` hay chưa, thay vì
 *   `setState` đồng bộ trong effect (tránh cascading render, xem eslint
 *   `react-hooks` "Calling setState synchronously within an effect").
 * - Đặt riêng file (không export từ `.jsx` component) để không vi phạm
 *   eslint `react-refresh/only-export-components`.
 *
 * Exports:
 *   useStages (default) → { stages, loading, reload }
 */
import { useCallback, useEffect, useState } from "react";
import { listStages } from "../api/crm";

export default function useStages(entityType = "DEAL", includeInactive = false) {
  const key = `${entityType}:${includeInactive}`;
  const [state, setState] = useState({ key: null, stages: [], loaded: false });

  useEffect(() => {
    let active = true;
    listStages(entityType, includeInactive)
      .then((res) => {
        if (active) setState({ key, stages: res?.stages || [], loaded: true });
      })
      .catch(() => {
        if (active) setState({ key, stages: [], loaded: true });
      });
    return () => {
      active = false;
    };
  }, [key, entityType, includeInactive]);

  const matches = state.key === key;
  const reload = useCallback(() => {
    setState((prev) => ({ ...prev, key: null, loaded: false }));
  }, []);

  return { stages: matches ? state.stages : [], loading: !matches || !state.loaded, reload };
}
