/**
 * Frontend: components/pos/TablePicker.jsx — Chọn bàn cho POS DINE_IN
 *
 * Tổng quan:
 * - Modal hiển thị bàn theo khu vực (Area) với trạng thái màu
 * - Bàn AVAILABLE → nhập số khách → mở bàn (POST /tables/:id/open) → chọn
 * - Bàn OCCUPIED → chọn ngay (dùng session đang mở)
 * - Bàn DIRTY/RESERVED → không chọn được
 *
 * Props:
 * - open, onClose
 * - onSelect(table, { sessionId, guestCount }) — trả bàn đã chọn + session
 */
import { useState, useCallback, useEffect } from "react";
import {
  Modal,
  Row,
  Col,
  Button,
  Tag,
  InputNumber,
  Space,
  Segmented,
  message,
  Empty,
  Spin,
} from "antd";
import { EnvironmentOutlined, ReloadOutlined } from "@ant-design/icons";
import api from "../../api/axios";

const STATUS_CONFIG = {
  AVAILABLE: { color: "#10b981", bg: "#ecfdf5", label: "Trống" },
  OCCUPIED: { color: "#ef4444", bg: "#fef2f2", label: "Có khách" },
  RESERVED: { color: "#f59e0b", bg: "#fffbeb", label: "Đặt trước" },
  DIRTY: { color: "#6b7280", bg: "#f3f4f6", label: "Cần dọn" },
};

export default function TablePicker({ open, onClose, onSelect }) {
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeAreaId, setActiveAreaId] = useState(null);
  const [guestModal, setGuestModal] = useState(null);
  const [guests, setGuests] = useState(2);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/tables/areas");
      const data = res.data?.data || [];
      setAreas(data);
      setActiveAreaId((prev) =>
        prev && data.some((a) => a.id === prev) ? prev : data[0]?.id || null,
      );
    } catch {
      message.error("Không tải được danh sách bàn");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const activeArea = areas.find((a) => a.id === activeAreaId);

  const chooseOccupied = (table) => {
    onSelect(table, {
      sessionId: table.currentSessionId,
      guestCount: 0,
    });
    onClose();
  };

  const handleOpenTable = async () => {
    if (!guestModal) return;
    setOpening(true);
    try {
      const res = await api.post(`/tables/${guestModal.id}/open`, {
        guestCount: guests,
      });
      const session = res.data?.data || res.data;
      onSelect(guestModal, { sessionId: session.id, guestCount: guests });
      message.success(`Đã mở bàn ${guestModal.code}`);
      setGuestModal(null);
      onClose();
    } catch (err) {
      message.error(err.response?.data?.message || "Không mở được bàn");
    } finally {
      setOpening(false);
    }
  };

  const handleClickTable = (table) => {
    if (table.status === "AVAILABLE") {
      setGuests(2);
      setGuestModal(table);
      return;
    }
    if (table.status === "OCCUPIED") {
      chooseOccupied(table);
      return;
    }
    if (table.status === "RESERVED") {
      message.warning("Bàn đang được đặt trước");
      return;
    }
    message.warning("Bàn đang cần dọn — hãy dọn trước khi sử dụng");
  };

  return (
    <>
      <Modal
        title={
          <Space>
            <EnvironmentOutlined style={{ color: "var(--primary)" }} />
            Chọn bàn
          </Space>
        }
        open={open}
        onCancel={onClose}
        footer={
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            Làm mới
          </Button>
        }
        width={720}
        destroyOnClose
      >
        {loading ? (
          <div style={{ display: "grid", placeItems: "center", padding: 48 }}>
            <Spin />
          </div>
        ) : areas.length === 0 ? (
          <Empty description="Chưa có bàn nào — vào Sơ đồ bàn để tạo bàn">
            <Button onClick={onClose}>Đóng</Button>
          </Empty>
        ) : (
          <>
            <Segmented
              options={areas.map((a) => ({ label: a.name, value: a.id }))}
              value={activeAreaId}
              onChange={setActiveAreaId}
              style={{ marginBottom: 16 }}
            />
            <Row gutter={[12, 12]}>
              {activeArea?.tables
                ?.filter((t) => t.isActive)
                .map((table) => {
                  const cfg =
                    STATUS_CONFIG[table.status] || STATUS_CONFIG.AVAILABLE;
                  return (
                    <Col key={table.id} xs={8} sm={6} md={4}>
                      <button
                        type="button"
                        onClick={() => handleClickTable(table)}
                        disabled={!["AVAILABLE", "OCCUPIED"].includes(
                          table.status,
                        )}
                        style={{
                          width: "100%",
                          padding: "12px 4px",
                          border: `2px solid ${cfg.color}`,
                          borderRadius: 10,
                          background: cfg.bg,
                          cursor:
                            table.status === "AVAILABLE" ||
                            table.status === "OCCUPIED"
                              ? "pointer"
                              : "not-allowed",
                          textAlign: "center",
                          opacity:
                            table.status === "AVAILABLE" ||
                            table.status === "OCCUPIED"
                              ? 1
                              : 0.6,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 18,
                            fontWeight: 700,
                            color: cfg.color,
                          }}
                        >
                          {table.code}
                        </div>
                        <Tag color={cfg.color} style={{ marginTop: 4 }}>
                          {cfg.label}
                        </Tag>
                        <div style={{ fontSize: 11, color: "#6b7280" }}>
                          {table.capacity} chỗ
                        </div>
                      </button>
                    </Col>
                  );
                })}
            </Row>
          </>
        )}
      </Modal>

      <Modal
        title={`Mở bàn ${guestModal?.code || ""}`}
        open={!!guestModal}
        onOk={handleOpenTable}
        onCancel={() => setGuestModal(null)}
        confirmLoading={opening}
        okText="Mở bàn"
        cancelText="Hủy"
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <label>Số khách</label>
          <InputNumber
            min={1}
            max={50}
            value={guests}
            onChange={(value) => setGuests(value || 1)}
            style={{ width: "100%" }}
          />
        </Space>
      </Modal>
    </>
  );
}
