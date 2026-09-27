import { useState, useEffect } from "react";
import { Card, Table, Button, Space, Tag, Typography, Alert, Progress, Modal } from "antd";
import {
  CloudUploadOutlined, DownloadOutlined, DeleteOutlined,
  ReloadOutlined, WarningOutlined,
} from "@ant-design/icons";
import axios from "../../api/axios";
import useToast from "../../components/shared/useToast";
import useConfirm from "../../components/shared/useConfirm";

const { Title, Text } = Typography;

export default function AdminBackups() {
  const toast = useToast();
  const confirm = useConfirm();

  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(null);
  const [restoreModal, setRestoreModal] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get("/admin/backups");
      setBackups(res.data?.data || []);
    } catch {
      toast.error("Không tải được danh sách backup");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await axios.post("/admin/backup");
      toast.success("Tạo backup thành công");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Tạo backup thất bại");
    } finally { setCreating(false); }
  };

  const handleRestore = async () => {
    if (!restoreModal) return;
    setRestoring(restoreModal);
    try {
      await axios.post(`/admin/backups/${restoreModal}/restore`);
      toast.success("Khôi phục thành công! Hệ thống đã sẵn sàng.");
      setRestoreModal(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Khôi phục thất bại");
    } finally { setRestoring(null); }
  };

  const handleDelete = (id) => {
    confirm.deleteConfirm({
      title: "Xóa bản backup?",
      content: "File backup sẽ bị xóa vĩnh viễn.",
      onOk: async () => {
        try {
          await axios.delete(`/admin/backups/${id}`);
          toast.success("Đã xóa backup");
          load();
        } catch {
          toast.error("Xóa thất bại");
        }
      },
    });
  };

  const formatBytes = (bytes) => {
    if (!bytes) return "0 B";
    const val = Number(bytes);
    if (val < 1024) return `${val} B`;
    if (val < 1048576) return `${(val / 1024).toFixed(1)} KB`;
    return `${(val / 1048576).toFixed(2)} MB`;
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>Backup & Khôi phục</Title>
          <Text type="secondary">Sao lưu và phục hồi toàn bộ cơ sở dữ liệu hệ thống</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>Làm mới</Button>
          <Button type="primary" icon={<CloudUploadOutlined />} loading={creating} onClick={handleCreate}>
            Tạo backup
          </Button>
        </Space>
      </div>

      <Alert
        type="warning"
        showIcon
        icon={<WarningOutlined />}
        message="Thao tác khôi phục sẽ ghi đè toàn bộ dữ liệu hiện tại. Chỉ thực hiện khi thực sự cần thiết."
        style={{ marginBottom: 16 }}
      />

      <Card bordered={false} className="shadow-sm" style={{ borderRadius: 8 }}>
        <Table
          dataSource={backups}
          rowKey="id"
          loading={loading}
          pagination={false}
          columns={[
            { title: "Tên file", dataIndex: "filename", ellipsis: true },
            {
              title: "Dung lượng", dataIndex: "sizeBytes", width: 120,
              render: (v) => <Tag>{formatBytes(v)}</Tag>,
            },
            {
              title: "Ngày tạo", dataIndex: "createdAt", width: 180,
              render: (v) => new Date(v).toLocaleString("vi-VN"),
            },
            {
              title: "", width: 160, align: "right",
              render: (_, row) => (
                <Space>
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => setRestoreModal(row.id)}
                    loading={restoring === row.id}
                  >
                    Khôi phục
                  </Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(row.id)} />
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="Xác nhận khôi phục"
        open={!!restoreModal}
        onCancel={() => setRestoreModal(null)}
        onOk={handleRestore}
        confirmLoading={!!restoring}
        okText="Khôi phục"
        okButtonProps={{ danger: true }}
        cancelText="Hủy"
      >
        <Alert
          type="error"
          showIcon
          message="Cảnh báo: Dữ liệu hiện tại sẽ bị ghi đè!"
          description="Sau khi khôi phục, toàn bộ dữ liệu hiện có sẽ được thay thế bằng dữ liệu từ bản backup. Hành động này không thể hoàn tác."
          style={{ marginBottom: 16 }}
        />
        <Text>Bạn có chắc chắn muốn khôi phục từ bản backup này?</Text>
      </Modal>
    </div>
  );
}
