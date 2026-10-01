/**
 * Frontend: pages/VendorKraljic.jsx — Ma trận Kraljic + Vendor Scorecard (Mục 5, 6.4)
 *
 * Tổng quan:
 * - Ma trận Kraljic 2x2: trục X = RỦI RO NGUỒN CUNG (supplyRiskScore), trục Y = TÁC ĐỘNG
 *   LỢI NHUẬN (profitImpactScore), thang 1–10; "Cao" = >= 6 (ngưỡng server KRALJIC_HIGH_THRESHOLD).
 *   Cao/Cao = STRATEGIC · Cao/Thấp = LEVERAGE · Thấp/Cao = BOTTLENECK · Thấp/Thấp = ROUTINE.
 * - kraljicCategory do SERVER tự suy (vendor.service.deriveKraljic) — FE chỉ gửi 2 điểm 1–10
 *   qua PATCH /accounting/vendors/:id/kraljic; đánh giá do người mua nhập tay (Mục 5.2).
 * - Scorecard (OTIF% / defectRate% / hạng A-B-C) chỉ ĐỌC: job vendor-scorecard.job.js chạy
 *   đầu mỗi tháng (quét kỳ tháng trước) và ghi vào Vendor.
 *
 * Exports:
 * - VendorKraljic (default): ma trận + bảng đánh giá + modal nhập điểm
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert, Button, Card, Col, Form, Input, Modal, Row, Segmented,
  Slider, Space, Table, Tag, Tooltip, Typography,
} from "antd";
import {
  ApartmentOutlined, EditOutlined, InfoCircleOutlined, ReloadOutlined, SearchOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/layout/PageHeader";
import EmptyState from "../components/shared/EmptyState";
import useToast from "../components/shared/useToast";
import { getVendors } from "../api/accounting";
import { updateVendorKraljic } from "../api/srm";
import useAuthStore from "../stores/authStore";

const { Text, Paragraph } = Typography;

// KHÔNG export: file này chỉ export component, để react-refresh (Vite HMR) hoạt
// động đúng. Cả 3 hằng/hàm dưới đây chỉ dùng nội bộ file.
const KRALJIC_LABEL = {
  STRATEGIC: "Chiến lược",
  LEVERAGE: "Đòn bẩy",
  BOTTLENECK: "Nút thắt",
  ROUTINE: "Thông thường",
};
const KRALJIC_COLOR = { STRATEGIC: "#7c3aed", LEVERAGE: "#0d9488", BOTTLENECK: "#f59e0b", ROUTINE: "#64748b" };
const KRALJIC_HINT = {
  STRATEGIC: "Hợp tác dài hạn, chia sẻ dữ liệu, cam kết sản lượng",
  LEVERAGE: "Đấu thầu, đàm phán giá, nhiều NCC thay thế được",
  BOTTLENECK: "Giữ tồn kho an toàn, tìm nguồn thay thế, hợp đồng dài hạn",
  ROUTINE: "Tự động hoá đặt hàng, chuẩn hoá quy trình, mua gộp",
};
const GRADE_COLOR = { A: "green", B: "blue", C: "red" };
// Suy loại Kraljic giống server (>= 6 = Cao) để vẽ ma trận phía FE
// KHÔNG export — xem giải thích ở KRALJIC_LABEL.
const classify = (profitImpactScore, supplyRiskScore) => {
  const hi = (v) => Number(v) >= 6;
  if (hi(profitImpactScore) && hi(supplyRiskScore)) return "STRATEGIC";
  if (hi(profitImpactScore)) return "LEVERAGE";
  if (hi(supplyRiskScore)) return "BOTTLENECK";
  return "ROUTINE";
};
export default function VendorKraljic() {
  const navigate = useNavigate();
  const toast = useToast();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = ["ADMIN", "MANAGER"].includes(role);

  const [loading, setLoading] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getVendors({ limit: 500 });
      setVendors(r.vendors || []);
    } catch (e) {
      toast.error(e.response?.data?.message || "Không tải được danh sách nhà cung cấp");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Nhóm NCC vào 4 ô ma trận theo điểm đã chấm; chưa chấm → unscored
  const { buckets, unscored } = useMemo(() => {
    const b = { STRATEGIC: [], LEVERAGE: [], BOTTLENECK: [], ROUTINE: [] };
    const pending = [];
    for (const v of vendors) {
      if (v.profitImpactScore == null || v.supplyRiskScore == null) { pending.push(v); continue; }
      b[classify(v.profitImpactScore, v.supplyRiskScore)].push(v);
    }
    return { buckets: b, unscored: pending };
  }, [vendors]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return vendors.filter((v) => {
      if (kw && ![v.name, v.code, v.phone, v.taxCode].some((f) => (f || "").toLowerCase().includes(kw))) {
        return false;
      }
      if (categoryFilter === "ALL") return true;
      if (categoryFilter === "UNSCORED") return v.profitImpactScore == null || v.supplyRiskScore == null;
      return v.kraljicCategory === categoryFilter;
    });
  }, [vendors, search, categoryFilter]);

  const openEdit = (v) => {
    setEditing(v);
    form.setFieldsValue({
      profitImpactScore: v.profitImpactScore ?? 5,
      supplyRiskScore: v.supplyRiskScore ?? 5,
    });
  };

  const doSave = async () => {
    let values;
    try { values = await form.validateFields(); }
    catch { return; }
    setSaving(true);
    try {
      await updateVendorKraljic(editing.id, {
        profitImpactScore: Number(values.profitImpactScore),
        supplyRiskScore: Number(values.supplyRiskScore),
      });
      toast.success("Đã cập nhật đánh giá Kraljic");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || "Lỗi cập nhật đánh giá");
    } finally {
      setSaving(false);
    }
  };
  const matrixCell = (key) => (
    <div
      style={{
        border: `1px solid ${KRALJIC_COLOR[key]}33`,
        borderTop: `3px solid ${KRALJIC_COLOR[key]}`,
        borderRadius: 10,
        padding: 12,
        minHeight: 150,
        background: `${KRALJIC_COLOR[key]}0d`,
      }}
    >
      <Space style={{ marginBottom: 8 }}>
        <Tag color={KRALJIC_COLOR[key]}>{KRALJIC_LABEL[key]}</Tag>
        <Text strong>{buckets[key].length} NCC</Text>
      </Space>
      <Tooltip title={KRALJIC_HINT[key]}>
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
          {KRALJIC_HINT[key]}
        </Paragraph>
      </Tooltip>
      <Space wrap size={4}>
        {buckets[key].slice(0, 12).map((v) => (
          <Tag key={v.id} style={{ cursor: "pointer" }} onClick={() => openEdit(v)}>{v.name}</Tag>
        ))}
        {buckets[key].length > 12 && <Tag>+{buckets[key].length - 12}</Tag>}
        {!buckets[key].length && <Text type="secondary" style={{ fontSize: 12 }}>Chưa có NCC</Text>}
      </Space>
    </div>
  );

  const columns = [
    {
      title: "Nhà cung cấp", width: 220,
      render: (_, r) => (
        <a onClick={() => navigate("/vendors")} style={{ fontWeight: 600 }}>{r.name}</a>
      ),
    },
    { title: "Mã", width: 110, render: (_, r) => <Text code>{r.code}</Text> },
    {
      title: "Tác động lợi nhuận", width: 140, align: "center",
      render: (_, r) => (r.profitImpactScore == null ? <Text type="secondary">—</Text> : `${r.profitImpactScore}/10`),
    },
    {
      title: "Rủi ro nguồn cung", width: 140, align: "center",
      render: (_, r) => (r.supplyRiskScore == null ? <Text type="secondary">—</Text> : `${r.supplyRiskScore}/10`),
    },
    {
      title: "Loại Kraljic", width: 140,
      render: (_, r) => (r.kraljicCategory
        ? <Tag color={KRALJIC_COLOR[r.kraljicCategory]}>{KRALJIC_LABEL[r.kraljicCategory]}</Tag>
        : <Text type="secondary">Chưa đánh giá</Text>),
    },
    {
      title: "OTIF", width: 100, align: "right",
      render: (_, r) => (r.otifScore == null ? <Text type="secondary">—</Text> : `${Number(r.otifScore).toFixed(1)}%`),
    },
    {
      title: "Tỷ lệ lỗi", width: 100, align: "right",
      render: (_, r) => (r.defectRate == null ? <Text type="secondary">—</Text> : `${Number(r.defectRate).toFixed(1)}%`),
    },
    {
      title: "Hạng", width: 90, align: "center",
      render: (_, r) => (r.vendorGrade
        ? <Tag color={GRADE_COLOR[r.vendorGrade]}>{r.vendorGrade}</Tag>
        : <Text type="secondary">—</Text>),
    },
    {
      title: "Thao tác", width: 110, fixed: "right",
      render: (_, r) => (
        <Tooltip title={canEdit ? "Nhập điểm Kraljic" : "Chỉ ADMIN/MANAGER được sửa"}>
          <Button type="link" size="small" icon={<EditOutlined />} disabled={!canEdit} onClick={() => openEdit(r)}>
            Đánh giá
          </Button>
        </Tooltip>
      ),
    },
  ];
  return (
    <div>
      <PageHeader
        title="Ma trận Kraljic — Phân loại nhà cung cấp"
        subtitle="Đánh giá định kỳ theo tác động lợi nhuận và rủi ro nguồn cung (1–10, Cao >= 6)"
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Làm mới</Button>
            <Button type="link" onClick={() => navigate("/vendors")}>Danh sách NCC</Button>
          </Space>
        }
      />

      <Alert
        type="info" showIcon icon={<InfoCircleOutlined />} style={{ marginBottom: 16 }}
        message="Cách phân loại"
        description="Hai điểm 1–10 do người mua hàng nhập tay; hệ thống tự suy loại: Cao/Cao = Chiến lược, Cao/Thấp = Đòn bẩy, Thấp/Cao = Nút thắt, Thấp/Thấp = Thông thường. OTIF%, tỷ lệ lỗi và hạng A/B/C được tính tự động đầu mỗi tháng từ phiếu nhận hàng (GRN)."
      />

      <Card title={<Space><ApartmentOutlined /> Ma trận 2x2</Space>} style={{ marginBottom: 16 }} loading={loading}>
        <Row gutter={12}>
          <Col span={12}>{matrixCell("BOTTLENECK")}</Col>
          <Col span={12}>{matrixCell("STRATEGIC")}</Col>
        </Row>
        <div style={{ display: "flex", justifyContent: "space-between", margin: "6px 0 10px" }}>
          <Text type="secondary" style={{ fontSize: 12 }}>← Tác động lợi nhuận THẤP</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>Tác động lợi nhuận CAO →</Text>
        </div>
        <Row gutter={12}>
          <Col span={12}>{matrixCell("ROUTINE")}</Col>
          <Col span={12}>{matrixCell("LEVERAGE")}</Col>
        </Row>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>← Rủi ro nguồn cung THẤP</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>Rủi ro nguồn cung CAO →</Text>
        </div>
        {unscored.length > 0 && (
          <Alert
            type="warning" showIcon style={{ marginTop: 16 }}
            message={`${unscored.length} nhà cung cấp chưa được đánh giá Kraljic`}
            description={'Nhấn vào mục "Chưa đánh giá" ở bảng bên dưới để nhập điểm.'}
          />
        )}
      </Card>

      <Card
        title="Bảng đánh giá nhà cung cấp"
        extra={
          <Space wrap>
            <Input
              allowClear prefix={<SearchOutlined style={{ color: "#94a3b8" }} />}
              placeholder="Tìm tên / mã / SĐT / MST" style={{ width: 220 }}
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
            <Segmented
              value={categoryFilter} onChange={setCategoryFilter}
              options={[
                { value: "ALL", label: "Tất cả" },
                { value: "STRATEGIC", label: KRALJIC_LABEL.STRATEGIC },
                { value: "LEVERAGE", label: KRALJIC_LABEL.LEVERAGE },
                { value: "BOTTLENECK", label: KRALJIC_LABEL.BOTTLENECK },
                { value: "ROUTINE", label: KRALJIC_LABEL.ROUTINE },
                { value: "UNSCORED", label: `Chưa đánh giá (${unscored.length})` },
              ]}
            />
          </Space>
        }
      >
        <Table
          rowKey="id" loading={loading} dataSource={filtered} columns={columns}
          scroll={{ x: 1150 }} size="small"
          locale={{ emptyText: <EmptyState description="Không có nhà cung cấp phù hợp" /> }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} nhà cung cấp` }}
        />
      </Card>

      <Modal
        open={!!editing} onCancel={() => setEditing(null)} onOk={doSave}
        confirmLoading={saving} okText="Lưu đánh giá" width={560}
        title={`Đánh giá Kraljic — ${editing?.name || ""}`}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="Tác động lợi nhuận (1–10)" name="profitImpactScore"
            rules={[{ required: true, message: "Chọn điểm" }]}
            extra="Giá trị mua hàng, ảnh hưởng tới doanh thu/lợi nhuận, chi phí chuyển đổi NCC"
          >
            <Slider min={1} max={10} step={1} marks={{ 1: "1", 6: "6 (Cao)", 10: "10" }} />
          </Form.Item>
          <Form.Item
            label="Rủi ro nguồn cung (1–10)" name="supplyRiskScore"
            rules={[{ required: true, message: "Chọn điểm" }]}
            extra="Số lượng NCC thay thế được, độ khan hiếm, thời gian giao hàng, rủi ro địa chính trị"
          >
            <Slider min={1} max={10} step={1} marks={{ 1: "1", 6: "6 (Cao)", 10: "10" }} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => {
              const p = getFieldValue("profitImpactScore");
              const s = getFieldValue("supplyRiskScore");
              if (p == null || s == null) return null;
              const k = classify(p, s);
              return (
                <Alert
                  type="success" showIcon
                  message={<span>Xếp loại dự kiến: <Tag color={KRALJIC_COLOR[k]}>{KRALJIC_LABEL[k]}</Tag></span>}
                  description={KRALJIC_HINT[k]}
                />
              );
            }}
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

