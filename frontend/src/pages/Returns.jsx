import { useEffect, useState } from "react";
import { Button, Drawer, Space, Table, Tag, message } from "antd";
import api from "../api/axios";
import MoneyDisplay from "../components/shared/MoneyDisplay";
import useAuthStore from "../stores/authStore";

const statusColor = {
  PENDING: "gold",
  APPROVED: "blue",
  REJECTED: "red",
  COMPLETED: "green",
};

export default function Returns() {
  const { user } = useAuthStore();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);

  const canApprove = ["ADMIN", "MANAGER"].includes(user?.role);

  const loadReturns = async () => {
    setLoading(true);
    try {
      const res = await api.get("/returns");
      setRows(res.data?.data || []);
    } catch (err) {
      message.error(err?.response?.data?.message || "Không tải được danh sách trả hàng");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReturns();
  }, []);

  const handleAction = async (id, action) => {
    try {
      await api.patch(`/returns/${id}/${action}`);
      message.success(action === "approve" ? "Đã duyệt trả hàng" : "Đã từ chối trả hàng");
      setSelected(null);
      loadReturns();
    } catch (err) {
      message.error(err?.response?.data?.message || "Không xử lý được phiếu trả hàng");
    }
  };

  return (
    <div>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        onRow={(record) => ({ onClick: () => setSelected(record) })}
        columns={[
          { title: "Mã trả hàng", dataIndex: "returnCode" },
          { title: "Đơn gốc", render: (_, row) => row.order?.orderCode || "-" },
          { title: "Trạng thái", dataIndex: "status", render: (value) => <Tag color={statusColor[value]}>{value}</Tag> },
          { title: "Hoàn tiền", dataIndex: "refundAmount", render: (value) => <MoneyDisplay value={value} /> },
          { title: "Ngày tạo", dataIndex: "createdAt", render: (value) => new Date(value).toLocaleString("vi-VN") },
        ]}
      />

      <Drawer title={selected?.returnCode} open={!!selected} onClose={() => setSelected(null)} width={520}>
        {selected && (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <div>Lý do: {selected.reason}</div>
            <div>Ghi chú: {selected.note || "-"}</div>
            <Table
              rowKey="id"
              pagination={false}
              dataSource={selected.items || []}
              columns={[
                { title: "Sản phẩm", render: (_, row) => row.orderItem?.product?.name || row.orderItemId },
                { title: "SL", dataIndex: "quantity" },
                { title: "Tiền hoàn", dataIndex: "refundAmount", render: (value) => <MoneyDisplay value={value} /> },
              ]}
            />
            {canApprove && selected.status === "PENDING" && (
              <Space>
                <Button type="primary" onClick={() => handleAction(selected.id, "approve")}>Duyệt</Button>
                <Button danger onClick={() => handleAction(selected.id, "reject")}>Từ chối</Button>
              </Space>
            )}
          </Space>
        )}
      </Drawer>
    </div>
  );
}
