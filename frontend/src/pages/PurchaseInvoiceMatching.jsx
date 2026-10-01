/**
 * Frontend: pages/PurchaseInvoiceMatching.jsx — Hoá đơn NCC + đối soát 3-way (Mục 6.2–6.3)
 *
 * Tổng quan:
 * - Ghi nhận hoá đơn NCC theo PO; server TỰ đối soát khi PO đã có GRN POSTED.
 * - Quy tắc (server, dung sai ±1% — không tính ở FE):
 *     grnAmount = Σ (passQty × PurchaseItem.unitCost) của GRN POSTED
 *     variance  = |invoiceAmount − grnAmount| / grnAmount
 *     ≤ 1%  → MATCHED (tạo công nợ phải trả qua Debt service)
 *     > 1%  → VARIANCE_HOLD (CHẶN thanh toán + thông báo ADMIN/ACCOUNTANT)
 *     ADMIN có thể "chấp nhận lệch" → APPROVED_OVERRIDE (vẫn tạo công nợ)
 *     grnAmount = 0 → giữ PENDING (chưa nhận hàng)
 * - Backend: /api/purchase-invoices — POST/GET: ADMIN/MANAGER/ACCOUNTANT; approve-override: ADMIN.
 *
 * Exports:
 * - PurchaseInvoiceMatching (default): bảng hoá đơn + modal ghi nhận + modal chi tiết
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal,
  Select, Space, Statistic, Table, Tag, Typography,
} from "antd";
import {
  CheckCircleOutlined, PlusOutlined, ReloadOutlined, SafetyOutlined, WarningOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../components/layout/PageHeader";
import EmptyState from "../components/shared/EmptyState";
import useToast from "../components/shared/useToast";
import {
  approveVariance, createMatching, getMatching, listGRNs, listMatchings, matchInvoice,
} from "../api/srm";
import { getPurchaseOrders } from "../api/accounting";
import useAuthStore from "../stores/authStore";

const { Text } = Typography;

const MATCH_LABEL = {
  PENDING: "Chờ đối soát", MATCHED: "Khớp", VARIANCE_HOLD: "Lệch — chặn TT", APPROVED_OVERRIDE: "Duyệt lệch",
};
const MATCH_COLOR = { PENDING: "default", MATCHED: "green", VARIANCE_HOLD: "red", APPROVED_OVERRIDE: "blue" };

const fmtVND = (v) => Number(v || 0).toLocaleString("vi-VN") + "đ";
const fmtPct = (v) => (v == null ? "—" : `${(Number(v) * 100).toFixed(2)}%`);
const fmtDate = (v) => (v ? dayjs(v).format("DD/MM/YYYY HH:mm") : "—");

// GRN POSTED của PO — hiển thị số tiền nhận hàng làm mốc đối chiếu (tự tính lại ở FE)
// KHÔNG export: file này chỉ export component (react-refresh/HMR). Không có file
// nào khác dùng hàm này.
const sumPostedGrn = (grns = []) =>
  grns
    .filter((g) => g.status === "POSTED")
    .reduce(
      (sum, g) => sum + (g.items || []).reduce(
        (s, i) => s + Number(i.purchaseItem?.unitCost || 0) * Number(i.passQty || 0), 0,
      ),
      0,
    );
export default function PurchaseInvoiceMatching() {
  const navigate = useNavigate();
  const toast = useToast();
  const role = useAuthStore((s) => s.user?.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const poIdFilter = searchParams.get("poId") || "";

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ page: 1, limit: 20, matchStatus: "" });

  const [poOptions, setPoOptions] = useState([]);
  const [poLoading, setPoLoading] = useState(false);
  const [grnAmount, setGrnAmount] = useState(null);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listMatchings({ ...filters, poId: poIdFilter || undefined });
      setRows(r.invoices || []);
      setTotal(r.pagination?.total || 0);
    } catch (e) {
      toast.error(e.response?.data?.message || "Không tải được hoá đơn NCC");
    } finally {
      setLoading(false);
    }
  }, [filters, poIdFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const [received, ordered] = await Promise.all([
          getPurchaseOrders({ limit: 100, status: "RECEIVED" }),
          getPurchaseOrders({ limit: 100, status: "ORDERED" }),
        ]);
        const list = [...(received.purchaseOrders || []), ...(ordered.purchaseOrders || [])];
        setPoOptions(
          list.map((p) => ({ value: p.id, label: `${p.poCode} — ${p.vendor?.name || ""}`.trim() })),
        );
      } catch { /* không chặn trang */ }
    })();
  }, []);

  const onPickPo = async (poId) => {
    setGrnAmount(null);
    setPoLoading(true);
    try {
      const r = await listGRNs({ poId, limit: 100 });
      setGrnAmount(sumPostedGrn(r.grns || []));
    } catch {
      setGrnAmount(null);
    } finally {
      setPoLoading(false);
    }
  };

  const openDetail = async (id) => {
    setDetailLoading(true);
    try { setDetail(await getMatching(id)); }
    catch (e) { toast.error(e.response?.data?.message || "Không tải được chi tiết"); }
    finally { setDetailLoading(false); }
  };
  const doCreate = async () => {
    let values;
    try { values = await createForm.validateFields(); }
    catch { return; }
    setSaving(true);
    try {
      const rec = await createMatching({
        purchaseOrderId: values.purchaseOrderId,
        invoiceNumber: String(values.invoiceNumber).trim(),
        invoiceAmount: Number(values.invoiceAmount),
        invoiceTax: Number(values.invoiceTax || 0),
      });
      toast.success(
        rec.matchStatus === "VARIANCE_HOLD"
          ? "Đã ghi nhận — LỆCH quá ±1%, đã chặn thanh toán"
          : rec.matchStatus === "MATCHED"
            ? "Đã ghi nhận — KHỚP, đã tạo công nợ phải trả"
            : "Đã ghi nhận — chờ nhận hàng để đối soát",
      );
      setCreateOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || "Lỗi ghi nhận hoá đơn");
    } finally {
      setSaving(false);
    }
  };

  const doMatch = async (row) => {
    setBusyId(row.id);
    try {
      const rec = await matchInvoice(row.id);
      if (rec.matchStatus === "VARIANCE_HOLD") toast.warning("Lệch quá dung sai ±1% — đã chặn thanh toán");
      else if (rec.matchStatus === "MATCHED") toast.success("Khớp — đã tạo công nợ phải trả");
      else toast.info("Chưa có hàng nhận (GRN POSTED) để đối soát");
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || "Lỗi đối soát");
    } finally {
      setBusyId(null);
    }
  };

  const doOverride = (row) => {
    Modal.confirm({
      title: `Chấp nhận lệch cho HĐ ${row.invoiceNumber}?`,
      content: "Chỉ ADMIN được phép. Công nợ phải trả sẽ được tạo theo hoá đơn NCC.",
      okText: "Chấp nhận", cancelText: "Huỷ", okButtonProps: { danger: true },
      onOk: async () => {
        setBusyId(row.id);
        try {
          await approveVariance(row.id);
          toast.success("Đã chấp nhận lệch (APPROVED_OVERRIDE)");
          load();
        } catch (e) {
          toast.error(e.response?.data?.message || "Lỗi duyệt lệch");
        } finally {
          setBusyId(null);
        }
      },
    });
  };
  const columns = [
    {
      title: "Số hoá đơn", width: 170,
      render: (_, r) => <Text strong>{r.invoiceNumber}</Text>,
    },
    {
      title: "PO", width: 160,
      render: (_, r) => (
        <a onClick={() => navigate(`/purchase-orders/${r.purchaseOrderId}`)}>
          {r.purchaseOrder?.poCode || "—"}
        </a>
      ),
    },
    { title: "Nhà cung cấp", width: 180, render: (_, r) => r.purchaseOrder?.vendor?.name || "—" },
    {
      title: "Tiền hàng nhận (GRN)", width: 160, align: "right",
      render: (_, r) => (
        <Text type="secondary">
          {r.varianceAmount != null && r.invoiceAmount != null
            ? fmtVND(Number(r.invoiceAmount) - Number(r.varianceAmount))
            : "—"}
        </Text>
      ),
    },
    { title: "Tiền hoá đơn", width: 150, align: "right", render: (_, r) => <Text strong>{fmtVND(r.invoiceAmount)}</Text> },
    { title: "Thuế", width: 120, align: "right", render: (_, r) => fmtVND(r.invoiceTax) },
    {
      title: "Lệch", width: 100, align: "right",
      render: (_, r) => (r.variancePct == null
        ? <Text type="secondary">—</Text>
        : <Text style={{ color: Number(r.variancePct) > 0.01 ? "#dc2626" : "#16a34a" }}>{fmtPct(r.variancePct)}</Text>),
    },
    {
      title: "Đối soát", width: 150,
      render: (_, r) => (
        <Tag
          color={MATCH_COLOR[r.matchStatus]}
          icon={r.matchStatus === "VARIANCE_HOLD" ? <WarningOutlined /> : undefined}
        >
          {MATCH_LABEL[r.matchStatus] || r.matchStatus}
        </Tag>
      ),
    },
    { title: "Ngày HĐ", width: 150, render: (_, r) => fmtDate(r.receivedAt) },
    {
      title: "Thao tác", width: 190, fixed: "right",
      render: (_, r) => (
        <Space size={4} wrap>
          <Button type="link" size="small" onClick={() => openDetail(r.id)}>Xem</Button>
          {["PENDING", "VARIANCE_HOLD"].includes(r.matchStatus) && (
            <Button
              type="link" size="small" icon={<CheckCircleOutlined />} loading={busyId === r.id}
              onClick={() => doMatch(r)}
            >
              Đối soát
            </Button>
          )}
          {r.matchStatus === "VARIANCE_HOLD" && role === "ADMIN" && (
            <Button
              type="link" size="small" danger icon={<SafetyOutlined />}
              loading={busyId === r.id} onClick={() => doOverride(r)}
            >
              Duyệt lệch
            </Button>
          )}
        </Space>
      ),
    },
  ];
  return (
    <div>
      <PageHeader
        title="Đối soát hoá đơn NCC (3-way)"
        subtitle="PO ↔ Phiếu nhận hàng ↔ Hoá đơn — dung sai ±1%, vượt ngưỡng sẽ chặn thanh toán"
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Làm mới</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setGrnAmount(null); setCreateOpen(true); }}>
              Ghi nhận hoá đơn
            </Button>
          </Space>
        }
      />

      <Alert
        type="info" showIcon style={{ marginBottom: 16 }}
        message="Cách đối soát"
        description="Hệ thống so tiền hoá đơn với tiền hàng THỰC NHẬN (GRN đã nhập kho: passQty × đơn giá PO). Lệch ≤ 1% → khớp và tự tạo công nợ; lệch > 1% → giữ lại và CHẶN thanh toán cho tới khi ADMIN duyệt lệch."
      />

      <Card style={{ marginBottom: 16 }}>
        <Space wrap size={12}>
          <Select
            placeholder="Trạng thái đối soát" allowClear style={{ width: 210 }}
            value={filters.matchStatus || undefined}
            onChange={(v) => setFilters((f) => ({ ...f, matchStatus: v || "", page: 1 }))}
            options={Object.keys(MATCH_LABEL).map((k) => ({ value: k, label: MATCH_LABEL[k] }))}
          />
          {poIdFilter && (
            <Tag closable onClose={() => setSearchParams({})} color="blue">
              Đang lọc theo PO được chọn
            </Tag>
          )}
          <Statistic title={<span style={{ color: "#64748b" }}>Số hoá đơn</span>} value={total} />
        </Space>
      </Card>

      <Table
        rowKey="id" loading={loading} dataSource={rows} columns={columns} scroll={{ x: 1500 }}
        locale={{ emptyText: <EmptyState description="Chưa có hoá đơn NCC nào được ghi nhận" /> }}
        pagination={{
          current: filters.page, pageSize: filters.limit, total, showSizeChanger: true,
          showTotal: (t) => `${t} hoá đơn`,
          onChange: (page, limit) => setFilters((f) => ({ ...f, page, limit: limit || 20 })),
        }}
      />

      <Modal
        open={createOpen} onCancel={() => setCreateOpen(false)} onOk={doCreate}
        confirmLoading={saving} okText="Ghi nhận" width={620}
        title="Ghi nhận hoá đơn nhà cung cấp"
      >
        <Form form={createForm} layout="vertical" onFinish={doCreate}>
          <Form.Item label="Đơn mua hàng (PO)" name="purchaseOrderId" rules={[{ required: true, message: "Chọn PO" }]}>
            <Select
              showSearch optionFilterProp="label" placeholder="Chọn PO đã duyệt/đã nhận hàng"
              options={poOptions} loading={poLoading} onChange={onPickPo}
            />
          </Form.Item>
          {grnAmount != null && (
            <Alert
              type={grnAmount > 0 ? "success" : "warning"} showIcon style={{ marginBottom: 16 }}
              message={`Tiền hàng thực nhận (GRN đã nhập kho): ${fmtVND(grnAmount)}`}
              description={grnAmount > 0
                ? "Lệch cho phép tối đa ±1% so với số này."
                : "PO chưa có GRN POSTED — hoá đơn sẽ giữ ở trạng thái chờ đối soát."}
            />
          )}
          <Form.Item
            label="Số hoá đơn" name="invoiceNumber"
            rules={[{ required: true, message: "Nhập số hoá đơn" }]}
          >
            <Input placeholder="VD: 0001234" />
          </Form.Item>
          <Form.Item
            label="Tiền hàng (chưa thuế)" name="invoiceAmount"
            rules={[{ required: true, message: "Nhập số tiền" }]}
          >
            <InputNumber style={{ width: "100%" }} min={0} step={1000} addonAfter="đ" placeholder="0" />
          </Form.Item>
          <Form.Item label="Thuế GTGT" name="invoiceTax">
            <InputNumber style={{ width: "100%" }} min={0} step={1000} addonAfter="đ" placeholder="0" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={!!detail} onCancel={() => setDetail(null)} footer={null}
        loading={detailLoading} width={640}
        title={detail ? `Hoá đơn ${detail.invoiceNumber}` : "Chi tiết hoá đơn NCC"}
      >
        {detail && (
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="PO">
              <a onClick={() => navigate(`/purchase-orders/${detail.purchaseOrderId}`)}>
                {detail.purchaseOrder?.poCode || "—"}
              </a>
            </Descriptions.Item>
            <Descriptions.Item label="Nhà cung cấp">{detail.purchaseOrder?.vendor?.name || "—"}</Descriptions.Item>
            <Descriptions.Item label="Tiền hoá đơn">{fmtVND(detail.invoiceAmount)}</Descriptions.Item>
            <Descriptions.Item label="Thuế">{fmtVND(detail.invoiceTax)}</Descriptions.Item>
            <Descriptions.Item label="Tổng PO">{fmtVND(detail.purchaseOrder?.total)}</Descriptions.Item>
            <Descriptions.Item label="Lệch">
              {detail.varianceAmount != null ? fmtVND(detail.varianceAmount) : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="Tỷ lệ lệch">{fmtPct(detail.variancePct)}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái">
              <Tag color={MATCH_COLOR[detail.matchStatus]}>
                {MATCH_LABEL[detail.matchStatus] || detail.matchStatus}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Ngày hoá đơn">{fmtDate(detail.receivedAt)}</Descriptions.Item>
            <Descriptions.Item label="Ngày đối soát">{fmtDate(detail.matchedAt)}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}



