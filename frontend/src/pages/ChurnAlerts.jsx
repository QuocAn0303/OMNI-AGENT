/**
 * Frontend: pages/ChurnAlerts.jsx — Cảnh báo rời bỏ khách hàng (Mục 4)
 *
 * Tổng quan:
 * - Danh sách ChurnAlert sinh tự động bởi cron (clv-forecast → churn-automation, chạy 01:00 hằng đêm).
 * - Chỉ ĐỌC: vòng đời PENDING → TRIGGERED (đã phát voucher) → RETAINED / LOST do backend
 *   tự đóng khi khách phát sinh đơn mới (checkRetainedForOrder) — FE không sửa trạng thái.
 * - riskLevel: HIGH (churn 0.70–0.85) / CRITICAL (> 0.85), ngưỡng cấu hình qua env CHURN_THRESHOLD.
 * - Backend: /api/churn-alerts (churn.routes.js) — ADMIN/MANAGER.
 *
 * Exports:
 * - ChurnAlerts (default): bảng alert + modal chi tiết (khách hàng, voucher win-back, hạn dùng)
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button, Card, Descriptions, Modal, Select, Space, Statistic, Table, Tag, Typography,
} from "antd";
import { EyeOutlined, ReloadOutlined, RiseOutlined, WarningOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../components/layout/PageHeader";
import EmptyState from "../components/shared/EmptyState";
import useToast from "../components/shared/useToast";
import { getChurnAlert, listChurnAlerts } from "../api/srm";

const { Text } = Typography;

const RISK_LABEL = { HIGH: "Cao", CRITICAL: "Nguy hiểm" };
const RISK_COLOR = { HIGH: "orange", CRITICAL: "red" };
const STATUS_LABEL = { PENDING: "Chờ xử lý", TRIGGERED: "Đã gửi voucher", RETAINED: "Giữ được khách", LOST: "Đã mất" };
const STATUS_COLOR = { PENDING: "default", TRIGGERED: "blue", RETAINED: "green", LOST: "red" };

const pct = (v) => (v == null ? "—" : `${(Number(v) * 100).toFixed(1)}%`);
const fmtDate = (v) => (v ? dayjs(v).format("DD/MM/YYYY HH:mm") : "—");

export default function ChurnAlerts() {
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ page: 1, limit: 20, riskLevel: "", status: "" });
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listChurnAlerts(filters);
      setRows(r.alerts || []);
      setTotal(r.pagination?.total || 0);
    } catch (e) {
      toast.error(e.response?.data?.message || "Không tải được cảnh báo churn");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id) => {
    setDetailLoading(true);
    try { setDetail(await getChurnAlert(id)); }
    catch (e) { toast.error(e.response?.data?.message || "Không tải được chi tiết"); }
    finally { setDetailLoading(false); }
  };

  const columns = [
    {
      title: "Khách hàng", width: 220,
      render: (_, r) => (
        <a onClick={() => navigate(`/customers/${r.customerId}`)} style={{ fontWeight: 600 }}>
          {r.customer?.name || r.customer?.phone || r.customerId}
        </a>
      ),
    },
    { title: "SĐT", width: 130, render: (_, r) => r.customer?.phone || "—" },
    { title: "Phân khúc RFM", width: 140, render: (_, r) => r.customer?.rfmSegment || "—" },
    {
      title: "Xác suất rời bỏ", width: 150, align: "right",
      render: (_, r) => (
        <Text strong style={{ color: r.churnScore > 0.85 ? "#dc2626" : "#ea580c" }}>
          {pct(r.churnScore)}
        </Text>
      ),
    },
    {
      title: "Mức độ", width: 120,
      render: (_, r) => <Tag color={RISK_COLOR[r.riskLevel]}>{RISK_LABEL[r.riskLevel] || r.riskLevel}</Tag>,
    },
    {
      title: "Voucher win-back", width: 200,
      render: (_, r) => (r.voucherCode
        ? <Tag color="green" icon={<RiseOutlined />}>{r.voucherCode}</Tag>
        : <Text type="secondary">Chưa phát hành</Text>),
    },
    { title: "Hạn voucher", width: 120, render: (_, r) => (r.expiresAt ? dayjs(r.expiresAt).format("DD/MM/YYYY") : "—") },
    {
      title: "Trạng thái", width: 140,
      render: (_, r) => <Tag color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status] || r.status}</Tag>,
    },
    { title: "Ngày tạo", width: 150, render: (_, r) => fmtDate(r.createdAt) },
    {
      title: "Thao tác", width: 100, fixed: "right",
      render: (_, r) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(r.id)}>Xem</Button>
      ),
    },
  ];
  return (
    <div>
      <PageHeader
        title="Cảnh báo rời bỏ khách hàng"
        subtitle="Hệ thống tự phát hiện khách nguy cơ mất và phát voucher win-back (chạy 01:00 hằng đêm)"
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Làm mới</Button>
            <Button type="link" onClick={() => navigate("/customers")}>Danh sách khách hàng</Button>
          </Space>
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <Space wrap size={12}>
          <Select
            placeholder="Mức độ" allowClear style={{ width: 150 }} value={filters.riskLevel || undefined}
            onChange={(v) => setFilters((f) => ({ ...f, riskLevel: v || "", page: 1 }))}
            options={Object.keys(RISK_LABEL).map((k) => ({ value: k, label: RISK_LABEL[k] }))}
          />
          <Select
            placeholder="Trạng thái" allowClear style={{ width: 170 }} value={filters.status || undefined}
            onChange={(v) => setFilters((f) => ({ ...f, status: v || "", page: 1 }))}
            options={Object.keys(STATUS_LABEL).map((k) => ({ value: k, label: STATUS_LABEL[k] }))}
          />
          <Statistic
            title={<span style={{ color: "#64748b" }}>Khách hàng nguy cơ mất</span>}
            value={total} prefix={<WarningOutlined style={{ color: "#f97316" }} />}
          />
        </Space>
      </Card>

      <Table
        rowKey="id" loading={loading} dataSource={rows} columns={columns} scroll={{ x: 1300 }}
        locale={{ emptyText: <EmptyState description="Chưa có cảnh báo — hệ thống tự chạy hằng đêm" /> }}
        pagination={{
          current: filters.page, pageSize: filters.limit, total, showSizeChanger: true,
          showTotal: (t) => `${t} cảnh báo`,
          onChange: (page, limit) => setFilters((f) => ({ ...f, page, limit: limit || 20 })),
        }}
      />

      <Modal
        open={!!detail} onCancel={() => setDetail(null)} footer={null}
        loading={detailLoading} width={720}
        title={detail ? `Cảnh báo rời bỏ — ${detail.customer?.name || ""}` : "Chi tiết cảnh báo"}
      >
        {detail && (
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="Khách hàng">{detail.customer?.name || "—"}</Descriptions.Item>
            <Descriptions.Item label="SĐT">{detail.customer?.phone || "—"}</Descriptions.Item>
            <Descriptions.Item label="Phân khúc RFM">{detail.customer?.rfmSegment || "—"}</Descriptions.Item>
            <Descriptions.Item label="Xác suất rời bỏ">{pct(detail.churnScore)}</Descriptions.Item>
            <Descriptions.Item label="Mức độ">
              <Tag color={RISK_COLOR[detail.riskLevel]}>{RISK_LABEL[detail.riskLevel] || detail.riskLevel}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Trạng thái">
              <Tag color={STATUS_COLOR[detail.status]}>{STATUS_LABEL[detail.status] || detail.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Voucher">{detail.voucherCode || "Chưa phát hành"}</Descriptions.Item>
            <Descriptions.Item label="Hạn dùng">
              {detail.expiresAt ? dayjs(detail.expiresAt).format("DD/MM/YYYY") : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="Chương trình KM" span={2}>
              {detail.promotion
                ? `${detail.promotion.name || detail.promotion.code || ""} (${detail.promotion.type || ""})`.trim()
                : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="Ngày tạo">{fmtDate(detail.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="Ngày xử lý">{fmtDate(detail.resolvedAt)}</Descriptions.Item>
            <Descriptions.Item label="Mở hồ sơ khách hàng" span={2}>
              <Button type="link" size="small" onClick={() => navigate(`/customers/${detail.customerId}`)}>
                Xem 360° khách hàng
              </Button>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}
