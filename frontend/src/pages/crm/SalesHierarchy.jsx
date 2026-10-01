/**
 * Frontend: src/pages/crm/SalesHierarchy.jsx — Cây báo cáo (Sales hierarchy)
 *
 * Tổng quan:
 * - Tương đương "Sales Hierarchy" của Frappe CRM: cho phép dựng cây quản lý
 *   (`User.reportsToId`) và xem ai đang phụ trách bao nhiêu lead/deal.
 * - Ảnh hưởng quyền xem thật: khi cây KHÔNG phẳng, quản lý chỉ thấy pipeline
 *   của mình + mọi bậc dưới (thay vì toàn tenant như Phase 2/3). Xem
 *   `src/modules/crm/scope.js:ownerScopeForTeam` + `hierarchy.service.js`.
 * - Cây phẳng (chưa ai được gán quản lý) → quyền giữ nguyên như cũ. Đây là điểm
 *   quan trọng khi rollout: admin phải dựng cây thì phạm vi mới bắt đầu siết.
 * - XEM cây: MANAGER+ (route + `RequireRole` trong App.jsx + `authorize` ở
 *   `hierarchy.routes.js`). SỬA cây (`PUT /:id/reports-to`): CHỈ ADMIN+ — CRM
 *   audit H1. Gán `reportsToId` là thay đổi "ai thấy pipeline của ai"; nếu MANAGER
 *   tự làm thì thu được phạm vi chi nhánh khác (leo thang cả quyền ghi). Trang này
 *   hiển thị chế độ chỉ đọc (Tag khoá) cho role không đủ quyền.
 *
 * Cách render: cây lồng nhau dạng danh sách đệ quy gọn (không dùng dnd tree —
 * backend đã chặn vòng lặp nên không cần validate thêm ở FE, và việc gán bằng
 * `Select` rõ ràng hơn kéo-thả cho dữ liệu nhỏ).
 *
 * Exports: SalesHierarchy (default)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card, Select, Button, Tag, Spin, Empty, Alert, Tooltip, message, Avatar,
} from "antd";
import {
  PartitionOutlined, ReloadOutlined, UserOutlined, CrownOutlined, TeamOutlined,
  WarningOutlined, LockOutlined,
} from "@ant-design/icons";
import PageHeader from "../../components/layout/PageHeader";
import StatCard from "../../components/shared/StatCard";
import { CRM_ADMIN_ROLES } from "../../components/crm/roles";
import useAuthStore from "../../stores/authStore";
import {
  getHierarchyTree,
  listHierarchyAssignable,
  setReportsTo as apiSetReportsTo,
} from "../../api/crm";

const ROLE_COLOR = {
  SUPER_OMEGA_ULTRA_ADMIN: "purple",
  SUPER_ADMIN: "purple",
  ADMIN: "gold",
  MANAGER: "blue",
  ACCOUNTANT: "default",
  CASHIER: "default",
  WAREHOUSE: "default",
};

/** Tổng lead/deal của cả nhánh (bao gồm bậc dưới) — tạo mới, không đổi object gốc */
const withBranchTotals = (node) => {
  const children = (node.children || []).map(withBranchTotals);
  return {
    ...node,
    children,
    branchLeads: (node.leadCount || 0) + children.reduce((s, c) => s + c.branchLeads, 0),
    branchDeals: (node.dealCount || 0) + children.reduce((s, c) => s + c.branchDeals, 0),
  };
};

function NodeRow({ node, isRoot, users, onAssign, savingId, canEditTree }) {
  const { t } = useTranslation();
  const options = useMemo(
    () =>
      users
        .filter((u) => u.id !== node.id)
        .map((u) => ({ value: u.id, label: u.fullName || u.email })),
    [users, node.id],
  );

  return (
    <div style={{ marginLeft: isRoot ? 0 : 24, borderLeft: isRoot ? "none" : "2px solid var(--border-color, #e5e7eb)", paddingLeft: isRoot ? 0 : 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 12px",
          borderRadius: 8,
          background: isRoot ? "var(--bg-secondary, #f8fafc)" : "transparent",
        }}
      >
        <Avatar size={32} src={node.avatar} icon={<UserOutlined />} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {isRoot && <CrownOutlined style={{ color: "#d97706" }} />}
            <strong style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {node.fullName || node.email}
            </strong>
            <Tag color={ROLE_COLOR[node.role] || "default"} style={{ marginInlineEnd: 0 }}>
              {node.role}
            </Tag>
            {!node.isActive && <Tag color="red">{t("crmPipeline.hierarchy.inactive")}</Tag>}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {node.email} · {t("crmPipeline.hierarchy.leads")}: {node.leadCount} · {t("crmPipeline.hierarchy.deals")}: {node.dealCount}
            {node.children?.length > 0 && (
              <> · {t("crmPipeline.hierarchy.branchTotal")}: {node.branchLeads}/{node.branchDeals}</>
            )}
          </div>
        </div>
        {canEditTree ? (
          <Tooltip title={t("crmPipeline.hierarchy.assignManager")}>
            <Select
              size="small"
              style={{ minWidth: 180 }}
              placeholder={t("crmPipeline.hierarchy.noManager")}
              value={node.reportsToId || null}
              loading={savingId === node.id}
              allowClear
              options={options}
              onChange={(value) => onAssign(node.id, value ?? null)}
            />
          </Tooltip>
        ) : (
          // CRM audit H1: MANAGER được XEM cây nhưng không được SỬA — gán
          // `reportsToId` là thay đổi "ai thấy pipeline của ai". Backend trả 403;
          // ở FE ta ẩn hẳn control để không dùng một UI chết rồi mới nhận lỗi.
          <Tooltip title={t("crmPipeline.hierarchy.readOnlyHint")}>
            <Tag icon={<LockOutlined />} style={{ marginInlineEnd: 0 }}>
              {node.reportsToId ? t("crmPipeline.hierarchy.hasManager") : t("crmPipeline.hierarchy.noManager")}
            </Tag>
          </Tooltip>
        )}
      </div>
      {(node.children || []).map((c) => (
        <NodeRow
          key={c.id}
          node={c}
          isRoot={false}
          users={users}
          onAssign={onAssign}
          savingId={savingId}
          canEditTree={canEditTree}
        />
      ))}
    </div>
  );
}

export default function SalesHierarchy() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  // CRM audit H1 — chỉ ADMIN+ được sửa cây (khớp `CRM_ADMIN_ROLES` ở backend).
  const canEditTree = CRM_ADMIN_ROLES.includes(user?.role);
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const tree = await getHierarchyTree();
      setData(tree);

      // Danh sách chỉ phục vụ `Select` quản lý. Nó hỏng không được làm mất cây.
      try {
        setUsers((await listHierarchyAssignable()) || []);
      } catch {
        setUsers([]);
      }
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.hierarchy.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const onAssign = async (userId, reportsToId) => {
    setSavingId(userId);
    try {
      await apiSetReportsTo(userId, reportsToId);
      // Nạp lại: cây + cache phạm vi ở backend đều đổi theo
      await load();
      message.success(t("crmPipeline.hierarchy.assignSuccess"));
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.hierarchy.assignFailed"));
    } finally {
      setSavingId(null);
    }
  };

  const roots = useMemo(
    () => (data?.roots || []).map(withBranchTotals),
    [data],
  );
  const isFlat = roots.length > 0 && roots.every((r) => !r.children?.length);

  if (loading && !data) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("crmPipeline.hierarchy.title")}
        subtitle={t("crmPipeline.hierarchy.subtitle")}
        actions={
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            {t("common.refresh", "Làm mới")}
          </Button>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 16 }}>
        <StatCard title={t("crmPipeline.hierarchy.totalUsers")} value={data?.totals?.users ?? 0} icon={<TeamOutlined />} loading={loading} />
        <StatCard title={t("crmPipeline.hierarchy.totalLeads")} value={data?.totals?.leads ?? 0} icon={<PartitionOutlined />} variant="info" loading={loading} />
        <StatCard title={t("crmPipeline.hierarchy.totalDeals")} value={data?.totals?.deals ?? 0} icon={<PartitionOutlined />} variant="success" loading={loading} />
      </div>

      <Alert
        type={isFlat ? "info" : "warning"}
        showIcon
        style={{ marginBottom: 16 }}
        message={
          isFlat
            ? t("crmPipeline.hierarchy.flatNotice")
            : t("crmPipeline.hierarchy.activeNotice")
        }
        description={isFlat ? t("crmPipeline.hierarchy.flatHelp") : t("crmPipeline.hierarchy.activeHelp")}
        icon={isFlat ? <WarningOutlined /> : undefined}
      />

      <Card>
        {roots.length === 0 ? (
          <Empty description={t("crmPipeline.hierarchy.empty")} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {roots.map((r) => (
              <NodeRow
                key={r.id}
                node={r}
                isRoot
                users={users}
                onAssign={onAssign}
                savingId={savingId}
                canEditTree={canEditTree}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

