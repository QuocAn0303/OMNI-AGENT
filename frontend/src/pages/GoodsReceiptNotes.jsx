/**
 * Frontend: pages/GoodsReceiptNotes.jsx — Phiếu nhận hàng NCC (GRN) + QC (Mục 6.1)
 *
 * Tổng quan:
 * - Danh sách GRN có phân trang, lọc theo PO / trạng thái, tìm theo mã GRN.
 * - Tạo GRN từ PO (chỉ PO APPROVED/ORDERED): chọn kho + nhập số lượng nhận từng dòng.
 * - Luồng: DRAFT → ghi nhận QC (pass/reject) → QC_DONE → nhập kho (POSTED).
 * - Backend: /api/grn (grn.routes.js) — KHÔNG có sửa/xóa GRN, POST là hành động không hoàn tác.
 * - Đọc query ?poId= để deep-link từ trang chi tiết PO.
 *
 * Exports:
 * - GoodsReceiptNotes (default): danh sách + modal tạo + modal QC + modal chi tiết
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal,
  Select, Space, Statistic, Table, Tag, Typography,
} from "antd";
import {
  CheckCircleOutlined, EyeOutlined, PlusOutlined, ReloadOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../components/layout/PageHeader";
import EmptyState from "../components/shared/EmptyState";
import useToast from "../components/shared/useToast";
import { createGRN, getGRN, listGRNs, postGRN, qcGRN } from "../api/srm";
import { getPurchaseOrder, getPurchaseOrders } from "../api/accounting";
import { getWarehouses } from "../api/warehouses";

const { Text } = Typography;

const STATUS_LABEL = { DRAFT: "Nháp", QC_PENDING: "Chờ QC", QC_DONE: "Đã QC", POSTED: "Đã nhập kho" };
const STATUS_COLOR = { DRAFT: "default", QC_PENDING: "orange", QC_DONE: "blue", POSTED: "green" };
const fmtDate = (v) => (v ? dayjs(v).format("DD/MM/YYYY HH:mm") : "—");
const fmtDay = (v) => (v ? dayjs(v).format("DD/MM/YYYY") : "—");
export default function GoodsReceiptNotes() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const poIdFilter = searchParams.get("poId") || "";

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ page: 1, limit: 20, status: "" });
  const [search, setSearch] = useState("");

  const [poOptions, setPoOptions] = useState([]);
  const [warehouses, setWarehouses] = useState([]);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [createRows, setCreateRows] = useState([]);
  const [poLoading, setPoLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [qcOpen, setQcOpen] = useState(false);
  const [qcRows, setQcRows] = useState([]);
  const [qcSaving, setQcSaving] = useState(false);
  const [postingId, setPostingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listGRNs({ ...filters, poId: poIdFilter || undefined });
      setRows(r.grns || []);
      setTotal(r.pagination?.total || 0);
    } catch (e) {
      toast.error(e.response?.data?.message || "Không tải được danh sách GRN");
    } finally {
      setLoading(false);
    }
  }, [filters, poIdFilter]);

  useEffect(() => { load(); }, [filters.page, filters.limit, filters.status, poIdFilter]);

  useEffect(() => {
    (async () => {
      try {
        const [approved, ordered] = await Promise.all([
          getPurchaseOrders({ limit: 100, status: "APPROVED" }),
          getPurchaseOrders({ limit: 100, status: "ORDERED" }),
        ]);
        const list = [...(approved.purchaseOrders || []), ...(ordered.purchaseOrders || [])];
        setPoOptions(
          list.map((p) => ({ value: p.id, label: `${p.poCode} — ${p.vendor?.name || ""}`.trim() })),
        );
      } catch { /* không chặn trang nếu chưa tải được PO */ }
    })();
    getWarehouses()
      .then((r) => setWarehouses(Array.isArray(r) ? r : r?.warehouses || []))
      .catch(() => {});
  }, []);

  const openDetail = async (id) => {
    setDetailLoading(true);
    try { setDetail(await getGRN(id)); }
    catch (e) { toast.error(e.response?.data?.message || "Không tải được GRN"); }
    finally { setDetailLoading(false); }
  };

  const loadPoItems = async (poId) => {
    setPoLoading(true);
    try {
      const po = await getPurchaseOrder(poId);
      setCreateRows(
        (po.items || []).map((it) => ({
          purchaseItemId: it.id,
          productId: it.productId,
          name: it.product?.name || "—",
          sku: it.product?.sku || "",
          orderedQty: it.quantity,
          receivedQty: it.quantity,
          lotCode: "",
        })),
      );
    } catch (e) {
      toast.error(e.response?.data?.message || "Không tải được dòng hàng của PO");
      setCreateRows([]);
    } finally {
      setPoLoading(false);
    }
  };

  const openCreate = () => {
    createForm.resetFields();
    setCreateRows([]);
    setCreateOpen(true);
    if (poIdFilter) {
      createForm.setFieldsValue({ purchaseOrderId: poIdFilter });
      loadPoItems(poIdFilter);
    } else if (warehouses.length) {
      createForm.setFieldsValue({ warehouseId: warehouses.find((w) => w.isDefault)?.id || warehouses[0].id });
    }
  };

  const doCreate = async () => {
    let values;
    try { values = await createForm.validateFields(); }
    catch { return; }
    const items = createRows
      .filter((r) => Number(r.receivedQty) >= 1)
      .map((r) => ({
        purchaseItemId: r.purchaseItemId,
        productId: r.productId,
        receivedQty: Number(r.receivedQty),
        lotCode: r.lotCode || null,
      }));
    if (!items.length) { toast.error("Cần ít nhất 1 dòng có số lượng nhận >= 1"); return; }
    const over = createRows.find((r) => Number(r.receivedQty) > Number(r.orderedQty));
    if (over) { toast.error(`"${over.name}" nhận vượt số lượng đặt (${over.orderedQty})`); return; }
    setSaving(true);
    try {
      const grn = await createGRN({ ...values, items });
      toast.success(`Đã tạo phiếu nhận hàng ${grn.grnCode || ""}`.trim());
      setCreateOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || "Lỗi tạo GRN");
    } finally {
      setSaving(false);
    }
  };

  const openQc = async (grn) => {
    try {
      const full = await getGRN(grn.id);
      setQcRows(
        (full.items || []).map((it) => ({
          id: it.id,
          name: it.product?.name || it.productId,
          sku: it.product?.sku || "",
          receivedQty: it.receivedQty,
          passQty: it.passQty || it.receivedQty,
          rejectQty: it.rejectQty || 0,
        })),
      );
      setDetail(full);
      setQcOpen(true);
    } catch (e) {
      toast.error(e.response?.data?.message || "Không tải được chi tiết GRN");
    }
  };

  const doQc = async () => {
    const bad = qcRows.find((r) => Number(r.passQty) + Number(r.rejectQty) !== Number(r.receivedQty));
    if (bad) {
      toast.error(`"${bad.name}": pass + reject phải bằng số lượng nhận (${bad.receivedQty})`);
      return;
    }
    setQcSaving(true);
    try {
      await qcGRN(detail.id, qcRows.map((r) => ({
        itemId: r.id, passQty: Number(r.passQty), rejectQty: Number(r.rejectQty),
      })));
      toast.success("Đã ghi nhận QC — GRN chuyển sang QC_DONE");
      setQcOpen(false);
      setDetail(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || "Lỗi ghi nhận QC");
    } finally {
      setQcSaving(false);
    }
  };

  const doPost = (grn) => {
    Modal.confirm({
      title: `Nhập kho cho ${grn.grnCode}?`,
      content: "Tồn kho (bình quân gia quyền + lô/hạn dùng) sẽ được ghi nhận và không thể hoàn tác.",
      okText: "Nhập kho",
      cancelText: "Huỷ",
      onOk: async () => {
        setPostingId(grn.id);
        try {
          await postGRN(grn.id);
          toast.success("Đã nhập kho (GRN POSTED)");
          setDetail(null);
          load();
        } catch (e) {
          toast.error(e.response?.data?.message || "Lỗi nhập kho");
        } finally {
          setPostingId(null);
        }
      },
    });
  };

  const setRow = (idx, key, value) =>
    setCreateRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  const setQcRow = (idx, key, value) =>
    setQcRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  const columns = [
    {
      title: "Mã GRN", dataIndex: "grnCode", width: 170, fixed: "left",
      render: (v, r) => <a onClick={() => openDetail(r.id)} style={{ fontWeight: 600 }}>{v}</a>,
    },
    {
      title: "Đơn mua (PO)", width: 170,
      render: (_, r) => (r.purchaseOrder?.poCode
        ? <a onClick={() => navigate(`/purchase-orders/${r.purchaseOrder.id}`)}>{r.purchaseOrder.poCode}</a>
        : "—"),
    },
    { title: "Nhà cung cấp", width: 220, render: (_, r) => r.purchaseOrder?.vendor?.name || "—" },
    { title: "Kho nhận", width: 160, render: (_, r) => r.warehouse?.name || "—" },
    {
      title: "SL nhận / Đạt / Lỗi", width: 170, align: "right",
      render: (_, r) => {
        const items = r.items || [];
        const recv = items.reduce((s, i) => s + (i.receivedQty || 0), 0);
        const pass = items.reduce((s, i) => s + (i.passQty || 0), 0);
        const rej = items.reduce((s, i) => s + (i.rejectQty || 0), 0);
        return (
          <Space size={4}>
            <Text strong>{recv}</Text>
            <Text type="secondary">/</Text>
            <Text style={{ color: "#16a34a" }}>{pass}</Text>
            <Text type="secondary">/</Text>
            <Text style={{ color: rej ? "#dc2626" : "#94a3b8" }}>{rej}</Text>
          </Space>
        );
      },
    },
    {
      title: "Đúng hạn", width: 110,
      render: (_, r) => (r.onTime == null
        ? "—"
        : <Tag color={r.onTime ? "green" : "red"}>{r.onTime ? "Đúng hạn" : "Trễ hạn"}</Tag>),
    },
    {
      title: "Trạng thái", width: 130,
      render: (_, r) => <Tag color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status] || r.status}</Tag>,
    },
    { title: "Ngày nhận", width: 150, render: (_, r) => fmtDate(r.receivedAt) },
    {
      title: "Thao tác", width: 230, fixed: "right",
      render: (_, r) => (
        <Space size={4}>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(r.id)}>
            Xem
          </Button>
          {["DRAFT", "QC_PENDING"].includes(r.status) && (
            <Button type="link" size="small" icon={<SafetyCertificateOutlined />} onClick={() => openQc(r)}>
              QC
            </Button>
          )}
          {r.status === "QC_DONE" && (
            <Button
              type="link" size="small" icon={<CheckCircleOutlined />} loading={postingId === r.id}
              onClick={() => doPost(r)}
            >
              Nhập kho
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const viewRows = search.trim()
    ? rows.filter((r) => (r.grnCode || "").toLowerCase().includes(search.trim().toLowerCase()))
    : rows;

  return (
    <div>
      <PageHeader
        title="Phiếu nhận hàng (GRN)"
        subtitle="Nhận hàng theo PO → ghi nhận QC → nhập kho (điều kiện để đối soát 3-way)"
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Làm mới</Button>
            <Button type="primary" icon={<PlusOutlined />} disabled={!poOptions.length} onClick={openCreate}>
              Tạo phiếu nhận
            </Button>
          </Space>
        }
      />

      {poIdFilter && (
        <Alert
          style={{ marginBottom: 16 }} type="info" showIcon
          message={`Đang lọc theo đơn mua — hiển thị ${total} phiếu nhận`}
          action={<Button size="small" type="link" onClick={() => setSearchParams({})}>Bỏ lọc</Button>}
        />
      )}

      <Card style={{ marginBottom: 16 }}>
        <Space wrap size={12}>
          <Input.Search
            placeholder="Tìm mã GRN" allowClear style={{ width: 200 }}
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            placeholder="Trạng thái" allowClear style={{ width: 160 }} value={filters.status || undefined}
            onChange={(v) => setFilters((f) => ({ ...f, status: v || "", page: 1 }))}
            options={Object.keys(STATUS_LABEL).map((k) => ({ value: k, label: STATUS_LABEL[k] }))}
          />
          <Statistic title={<span style={{ color: "#64748b" }}>Tổng phiếu</span>} value={total} />
        </Space>
      </Card>

      <Table
        rowKey="id" loading={loading} dataSource={viewRows} columns={columns} scroll={{ x: 1400 }}
        locale={{ emptyText: <EmptyState description="Chưa có phiếu nhận hàng — tạo từ đơn mua đã duyệt" /> }}
        pagination={{
          current: filters.page, pageSize: filters.limit, total,
          showSizeChanger: true, showTotal: (t) => `${t} phiếu nhận`,
          onChange: (page, limit) => setFilters((f) => ({ ...f, page, limit: limit || 20 })),
        }}
      />

      <Modal
        open={!!detail} onCancel={() => setDetail(null)} footer={null} width={880}
        loading={detailLoading} title={detail ? `Phiếu nhận ${detail.grnCode}` : "Chi tiết GRN"}
      >
        {detail && (
          <>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Đơn mua">{detail.purchaseOrder?.poCode || "—"}</Descriptions.Item>
              <Descriptions.Item label="Nhà cung cấp">{detail.purchaseOrder?.vendor?.name || "—"}</Descriptions.Item>
              <Descriptions.Item label="Kho nhận">{detail.warehouse?.name || "—"}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái">
                <Tag color={STATUS_COLOR[detail.status]}>{STATUS_LABEL[detail.status] || detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Ngày nhận">{fmtDate(detail.receivedAt)}</Descriptions.Item>
              <Descriptions.Item label="Dự kiến giao">{fmtDay(detail.purchaseOrder?.expectedAt)}</Descriptions.Item>
              <Descriptions.Item label="Đúng hạn" span={2}>
                {detail.onTime == null ? "Chưa xác định (tính khi nhập kho)"
                  : <Tag color={detail.onTime ? "green" : "red"}>{detail.onTime ? "Đúng hạn" : "Trễ hạn"}</Tag>}
              </Descriptions.Item>
            </Descriptions>
            <Table
              rowKey="id" size="small" pagination={false} dataSource={detail.items || []}
              columns={[
                { title: "Sản phẩm", render: (_, r) => r.product?.name || r.productId },
                { title: "SKU", width: 130, render: (_, r) => r.product?.sku || "—" },
                { title: "SL nhận", dataIndex: "receivedQty", width: 90, align: "right" },
                { title: "Đạt", dataIndex: "passQty", width: 80, align: "right" },
                { title: "Lỗi", dataIndex: "rejectQty", width: 80, align: "right" },
                { title: "Lô", dataIndex: "lotCode", width: 130, render: (v) => v || "—" },
                { title: "Hạn dùng", width: 120, render: (_, r) => fmtDay(r.expiryDate) },
              ]}
            />
          </>
        )}
      </Modal>
      <Modal
        open={createOpen} title="Tạo phiếu nhận hàng" width={900}
        onCancel={() => setCreateOpen(false)} onOk={doCreate}
        okText="Tạo GRN" cancelText="Huỷ" confirmLoading={saving}
      >
        <Form form={createForm} layout="vertical">
          <Space size={12} style={{ display: "flex", flexWrap: "wrap" }}>
            <Form.Item
              label="Đơn mua (APPROVED / ORDERED)" name="purchaseOrderId"
              rules={[{ required: true, message: "Chọn đơn mua" }]} style={{ minWidth: 320 }}
            >
              <Select
                showSearch optionFilterProp="label" placeholder="Chọn đơn mua"
                options={poOptions} onChange={loadPoItems}
              />
            </Form.Item>
            <Form.Item label="Kho nhận" name="warehouseId" rules={[{ required: true, message: "Chọn kho" }]}>
              <Select
                placeholder="Chọn kho" style={{ minWidth: 220 }}
                options={warehouses.map((w) => ({ value: w.id, label: w.isDefault ? `${w.name} (mặc định)` : w.name }))}
              />
            </Form.Item>
          </Space>
        </Form>
        <Table
          rowKey="purchaseItemId" size="small" loading={poLoading} pagination={false}
          dataSource={createRows}
          locale={{ emptyText: <EmptyState description="Chọn đơn mua để tải danh sách mặt hàng" /> }}
          columns={[
            { title: "Sản phẩm", render: (_, r) => r.name },
            { title: "SKU", dataIndex: "sku", width: 120, render: (v) => v || "—" },
            { title: "Đặt", dataIndex: "orderedQty", width: 80, align: "right" },
            {
              title: "SL nhận", width: 130, align: "right",
              render: (_, r, i) => (
                <InputNumber
                  min={0} max={r.orderedQty} value={r.receivedQty} style={{ width: 110 }}
                  onChange={(v) => setRow(i, "receivedQty", v)}
                />
              ),
            },
            {
              title: "Mã lô", width: 170,
              render: (_, r, i) => (
                <Input placeholder="Tuỳ chọn" value={r.lotCode} onChange={(e) => setRow(i, "lotCode", e.target.value)} />
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        open={qcOpen} title={`Ghi nhận QC — ${detail?.grnCode || ""}`} width={760}
        onCancel={() => setQcOpen(false)} onOk={doQc}
        okText="Xác nhận QC" cancelText="Huỷ" confirmLoading={qcSaving}
      >
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="Nhập số lượng ĐẠT và LỖI cho từng dòng — tổng phải bằng số lượng nhận."
        />
        <Table
          rowKey="id" size="small" pagination={false} dataSource={qcRows}
          columns={[
            { title: "Sản phẩm", render: (_, r) => r.name },
            { title: "SL nhận", dataIndex: "receivedQty", width: 90, align: "right" },
            {
              title: "Đạt", width: 130, align: "right",
              render: (_, r, i) => (
                <InputNumber
                  min={0} max={r.receivedQty} value={r.passQty} style={{ width: 110 }}
                  onChange={(v) => {
                    const n = Number(v || 0);
                    setQcRow(i, "passQty", n);
                    setQcRow(i, "rejectQty", Math.max(0, Number(r.receivedQty) - n));
                  }}
                />
              ),
            },
            {
              title: "Lỗi", width: 120, align: "right",
              render: (_, r, i) => (
                <InputNumber
                  min={0} max={r.receivedQty} value={r.rejectQty} style={{ width: 100 }}
                  onChange={(v) => setQcRow(i, "rejectQty", v)}
                />
              ),
            },
          ]}
        />
      </Modal>

    </div>
  );
}

