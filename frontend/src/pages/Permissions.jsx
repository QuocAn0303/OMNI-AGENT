import { useState, useEffect, useMemo } from "react";
import { Card, Table, Tag, Button, Space, Typography, Alert, Checkbox, Tooltip } from "antd";
import { SafetyCertificateOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import PageHeader from "../components/layout/PageHeader";
import axios from "../api/axios";
import useToast from "../components/shared/useToast";
import useConfirm from "../components/shared/useConfirm";

const { Title, Text } = Typography;

export default function Permissions() {
  const toast = useToast();
  const confirm = useConfirm();

  const [permissions, setPermissions] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState({}); // { roleKey: Set of permission keys }

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get("/auth/permissions");
      const data = res.data?.data || res.data;
      setPermissions(data.permissions || []);
      setRoles(data.roles || []);
      setDirty({});
    } catch {
      toast.error("Không tải được danh sách quyền");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const groupedPermissions = useMemo(() => {
    const groups = {};
    for (const p of permissions) {
      if (!groups[p.group]) groups[p.group] = [];
      groups[p.group].push(p);
    }
    return Object.entries(groups);
  }, [permissions]);

  const getRolePermissions = (role) => {
    const r = roles.find((r) => r.role === role);
    return new Set(r?.permissions || []);
  };

  const isChecked = (roleKey, permissionKey) => {
    if (dirty[roleKey]?.has(permissionKey) !== undefined) {
      return dirty[roleKey]?.has(permissionKey);
    }
    return getRolePermissions(roleKey).has(permissionKey);
  };

  const handleToggle = (roleKey, permissionKey, checked) => {
    setDirty((prev) => {
      const updated = new Set(prev[roleKey] || getRolePermissions(roleKey));
      if (checked) updated.add(permissionKey);
      else updated.delete(permissionKey);
      return { ...prev, [roleKey]: updated };
    });
  };

  const isDirty = Object.keys(dirty).length > 0;

  const hasPermissionChanges = (roleKey) => {
    if (!dirty[roleKey]) return false;
    const original = getRolePermissions(roleKey);
    if (dirty[roleKey].size !== original.size) return true;
    for (const key of dirty[roleKey]) {
      if (!original.has(key)) return true;
    }
    return false;
  };

  const handleSave = () => {
    const changedRoles = roles.filter((r) => hasPermissionChanges(r.role));
    if (changedRoles.length === 0) {
      toast.info("Không có thay đổi nào");
      return;
    }

    confirm.saveConfirm({
      title: "Lưu thay đổi phân quyền?",
      content: `Cập nhật quyền cho ${changedRoles.length} role(s): ${changedRoles.map((r) => r.label).join(", ")}`,
      onOk: async () => {
        setSaving(true);
        try {
          for (const r of changedRoles) {
            const permissionKeys = Array.from(dirty[r.role]);
            await axios.patch("/auth/permissions", { role: r.role, permissionKeys });
          }
          toast.success("Cập nhật phân quyền thành công");
          load();
        } catch (err) {
          toast.error(err?.response?.data?.message || "Lưu thất bại");
        } finally { setSaving(false); }
      },
    });
  };

  const columns = [
    {
      title: "Quyền", dataIndex: "label", key: "label", width: 220,
      render: (label, record) => (
        <Tooltip title={record.key}>
          <span>{label}</span>
        </Tooltip>
      ),
    },
    ...roles.map((r) => ({
      title: (
        <div style={{ textAlign: "center", fontSize: 12 }}>
          <div>{r.label}</div>
          <Tag color={hasPermissionChanges(r.role) ? "orange" : "default"} style={{ fontSize: 10, marginTop: 2 }}>
            {hasPermissionChanges(r.role) ? "Đã sửa" : r.permissions.length}
          </Tag>
        </div>
      ),
      key: r.role,
      width: 100,
      align: "center",
      render: (_, record) => (
        <Checkbox
          checked={isChecked(r.role, record.key)}
          onChange={(e) => handleToggle(r.role, record.key, e.target.checked)}
        />
      ),
    })),
  ];

  return (
    <div className="permissions-page">
      <PageHeader
        title="Phân quyền hệ thống"
        subtitle="Quản lý quyền truy cập cho từng vai trò"
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load}>Làm mới</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving} disabled={!isDirty}>
              Lưu thay đổi
            </Button>
          </Space>
        }
      />

      {isDirty && (
        <Alert
          type="warning"
          showIcon
          message="Bạn đang có thay đổi chưa được lưu"
          style={{ marginBottom: 16 }}
        />
      )}

      <Card bordered={false} className="shadow-sm" style={{ borderRadius: 8, overflow: "auto" }}>
        {groupedPermissions.map(([group, perms]) => (
          <div key={group} style={{ marginBottom: 24 }}>
            <Title level={5} style={{ marginBottom: 8, textTransform: "uppercase", fontSize: 13, color: "#6b7280" }}>
              {group}
            </Title>
            <Table
              dataSource={perms}
              rowKey="key"
              columns={columns}
              pagination={false}
              loading={loading}
              size="small"
              bordered
              style={{ marginBottom: 0 }}
            />
          </div>
        ))}
      </Card>
    </div>
  );
}
