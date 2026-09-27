import { useEffect, useState, useCallback } from "react";
import { Table, Button, message, Card, Modal } from "antd";
import PageHeader from "../components/layout/PageHeader";
import { getSessions, revokeSession, revokeAllSessions } from "../api/auth";

export default function Sessions() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getSessions());
    } catch (e) {
      message.error(e.response?.data?.message || "Lỗi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRevoke = (id) => {
    Modal.confirm({
      title: "Xác nhận",
      content: "Bạn có chắc muốn đăng xuất thiết bị này?",
      okText: "Đăng xuất",
      cancelText: "Hủy",
      onOk: async () => {
        try {
          await revokeSession(id);
          message.success("Đã đăng xuất thiết bị");
          load();
        } catch (e) {
          message.error(e.response?.data?.message || "Lỗi");
        }
      },
    });
  };

  const handleRevokeAll = () => {
    Modal.confirm({
      title: "Xác nhận",
      content: "Bạn có chắc muốn đăng xuất tất cả thiết bị?",
      okText: "Đăng xuất tất cả",
      cancelText: "Hủy",
      onOk: async () => {
        try {
          await revokeAllSessions();
          message.success("Đã đăng xuất tất cả thiết bị");
          load();
        } catch (e) {
          message.error(e.response?.data?.message || "Lỗi");
        }
      },
    });
  };

  const columns = [
    {
      title: "Đã tạo",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (val) => new Date(val).toLocaleString("vi-VN"),
    },
    {
      title: "Hết hạn",
      dataIndex: "expiresAt",
      key: "expiresAt",
      render: (val) => new Date(val).toLocaleString("vi-VN"),
    },
    {
      title: "",
      key: "actions",
      width: 100,
      render: (_, record) => (
        <Button type="link" danger onClick={() => handleRevoke(record.id)}>
          Hủy
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Phiên đăng nhập"
        extra={
          <Button danger onClick={handleRevokeAll}>
            Đăng xuất tất cả
          </Button>
        }
      />
      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={false}
        />
      </Card>
    </div>
  );
}
