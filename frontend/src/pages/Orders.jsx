/**
 * Frontend: pages/Orders.jsx — Quản lý đơn hàng
 * 
 * Tổng quan:
 * - Trang danh sách đơn hàng với bộ lọc (trạng thái, thanh toán, ngày) và tìm kiếm
 * - API: GET /orders, GET /orders/:id, GET /orders/:id/invoice, POST /orders/:id/payments, POST /returns
 * - State: data, filtered list, detail drawer, payment modal, return modal
 * - Logic: Lọc client-side theo search, payment, date range. Drawer xem chi tiết + ghi nhận thanh toán + trả hàng
 * 
 * Components/Hooks/Exports:
 * - Orders (default export): Bảng đơn hàng + chi tiết drawer + modal thanh toán/trả hàng
 * - SectionTitle, StackList, SummaryRow: Components nội bộ hỗ trợ hiển thị
 */
import { useEffect, useMemo, useRef, useState } from "react";
import useDebounce from '../hooks/useDebounce';
import {
  Button,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  message,
} from "antd";
import {
  DollarOutlined,
  DownloadOutlined,
  DownOutlined,
  EyeOutlined,
  FilterOutlined,
  PrinterOutlined,
  SearchOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { Joyride } from 'react-joyride';
import { useTranslation } from 'react-i18next';
import axios from "../api/axios";
import { dayjs, formatDate, formatTime, formatDateTime } from "../utils/date";
import PageHeader from "../components/layout/PageHeader";
import StatusTag, { STATUS_DICT } from "../components/shared/StatusTag";
import MoneyDisplay from "../components/shared/MoneyDisplay";
import EmptyState from "../components/shared/EmptyState";
import useAuthStore from "../stores/authStore";
import useTour from "../hooks/useTour";
import PermissionGate from "../components/shared/PermissionGate";

const { RangePicker } = DatePicker;

export default function Orders() {
  const { t } = useTranslation();
  const paymentOptions = [
    { value: "CASH", label: t('orders.paymentMethods.CASH') },
    { value: "BANK_TRANSFER", label: t('orders.paymentMethods.BANK_TRANSFER') },
    { value: "CARD", label: t('orders.paymentMethods.CARD') },
  ];
  useTour('orders');
  const { user } = useAuthStore();
  const canManage = ["ADMIN", "MANAGER"].includes(user?.role);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState(null);
  const [paymentFilter, setPaymentFilter] = useState(null);
  const [dateRange, setDateRange] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [detailReturnable, setDetailReturnable] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [paymentForm] = Form.useForm();
  const [returnForm] = Form.useForm();

  const normalizeOrder = (order) => ({
    ...order,
    orderNumber: order.orderCode,
    customerName: order.customer?.name || "",
    customerPhone: order.customer?.phone || "",
    itemCount: order.items?.length || 0,
    totalAmount: Number(order.total) || 0,
  });

  const loadOrders = async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (statusFilter) params.status = statusFilter;
      if (paymentFilter) params.paymentStatus = paymentFilter;
      if (dateRange) {
        params.fromDate = dateRange[0].toISOString();
        params.toDate = dateRange[1].toISOString();
      }
      const res = await axios.get("/orders", { params });
      const raw = res.data?.data || [];
      setData(raw.map(normalizeOrder));
      setTotal(res.data?.pagination?.total || 0);
    } catch {
      message.error(t('orders.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const loadOrdersRef = useRef(loadOrders);
  loadOrdersRef.current = loadOrders;

  useEffect(() => {
    loadOrders();
  }, [page, statusFilter, paymentFilter, dateRange]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, paymentFilter, dateRange]);

  useEffect(() => {
    const refresh = () => { loadOrdersRef.current(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('order-created', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('order-created', refresh);
    };
  }, []);

  const filtered = useMemo(() => debouncedSearch
    ? data.filter((order) => {
        const term = debouncedSearch.toLowerCase();
        return `${order.orderNumber} ${order.customerName}`.toLowerCase().includes(term);
      })
    : data, [data, debouncedSearch]);

  const openDetail = async (orderId) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const [orderRes, retRes] = await Promise.all([
        axios.get(`/orders/${orderId}`),
        axios.get(`/orders/${orderId}/returnable-items`).catch(() => ({ data: { data: [] } })),
      ]);
      setDetailData(normalizeOrder(orderRes.data?.data || orderRes.data));
      setDetailReturnable(retRes.data?.data?.items || []);
    } catch {
      message.error(t('orders.detailError'));
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async () => {
    if (!detailData?.id) return;
    const res = await axios.get(`/orders/${detailData.id}`);
    setDetailData(normalizeOrder(res.data?.data || res.data));
    await loadOrders();
  };

  const totalRevenue = useMemo(
    () => filtered.reduce((sum, order) => sum + (order.totalAmount || 0), 0),
    [filtered],
  );

  const handleDownloadInvoice = async () => {
    if (!detailData?.id) return;
    try {
      const res = await axios.get(`/orders/${detailData.id}/invoice`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `invoice-${detailData.orderCode}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      message.error(t('orders.invoiceError'));
    }
  };

  const handleRecordPayment = async () => {
    try {
      const values = await paymentForm.validateFields();
      await axios.post(`/orders/${detailData.id}/payments`, values);
      message.success(t('orders.paymentSuccess'));
      setPaymentOpen(false);
      paymentForm.resetFields();
      await refreshDetail();
    } catch (err) {
      if (!err.errorFields) message.error(err?.response?.data?.message || t('orders.paymentError'));
    }
  };

  const STATUS_TRANSITIONS = {
    PENDING: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["SHIPPING", "CANCELLED"],
    SHIPPING: ["COMPLETED", "CANCELLED"],
    COMPLETED: ["CANCELLED"],
    CANCELLED: [],
  };

  const handleStatusUpdate = async (newStatus) => {
    try {
      await axios.patch(`/orders/${detailData.id}/status`, { status: newStatus });
      message.success(t('orders.updateSuccess'));
      setDetailOpen(false);
      loadOrders();
    } catch (err) {
      message.error(err?.response?.data?.message || t('orders.updateError'));
    }
  };

  const handleCreateReturn = async () => {
    try {
      const values = await returnForm.validateFields();
      const selected = detailReturnable.find((i) => i.orderItemId === values.orderItemId);
      const maxQty = selected?.returnable || values.quantity;
      if (values.quantity > maxQty) {
        message.error(t('orders.returnQuantityError', { max: maxQty }));
        return;
      }
      await axios.post("/returns", {
        orderId: detailData.id,
        reason: values.reason,
        refundMethod: values.refundMethod,
        note: values.note,
        items: [{ orderItemId: values.orderItemId, quantity: values.quantity }],
      });
      message.success(t('orders.returnSuccess'));
      setReturnOpen(false);
      returnForm.resetFields();
      await refreshDetail();
    } catch (err) {
      if (!err.errorFields) message.error(err?.response?.data?.message || t('orders.returnError'));
    }
  };

  const columns = [
    {
      title: t('orders.orderCode'),
      dataIndex: "orderNumber",
      width: 150,
      render: (value) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{value}</span>,
    },
    {
      title: t('orders.customer'),
      dataIndex: "customerName",
      render: (value, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{value || t('orders.walkIn')}</div>
          {row.customerPhone && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{row.customerPhone}</div>}
        </div>
      ),
    },
    { title: t('orders.items'), dataIndex: "itemCount", width: 110, align: "right", render: (value) => t('orders.itemsCount', { count: value }) },
    { title: t('orders.total'), dataIndex: "totalAmount", width: 140, align: "right", sorter: (a, b) => a.totalAmount - b.totalAmount, render: (value) => <MoneyDisplay value={value} /> },
    { title: t('orders.payment'), dataIndex: "paymentStatus", width: 140, render: (value) => <StatusTag status={value} /> },
    { title: t('orders.status'), dataIndex: "status", width: 140, render: (value) => <StatusTag status={value} /> },
    {
      title: t('orders.createdAt'),
      dataIndex: "createdAt",
      width: 130,
      sorter: (a, b) => dayjs(a.createdAt).unix() - dayjs(b.createdAt).unix(),
      defaultSortOrder: "descend",
      render: (value) => (
        <div>
          <div style={{ fontSize: 13 }}>{formatDate(value)}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatTime(value)}</div>
        </div>
      ),
    },
    { title: "", width: 60, align: "right", fixed: "right", render: (_, row) => <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => openDetail(row.id)} /> },
  ];

  return (
    <>
      <PageHeader
        title={t('orders.title')}
        subtitle={<>{t('orders.count', { count: total })} · <span style={{ color: "var(--primary)", fontWeight: 500 }}><MoneyDisplay value={totalRevenue} short /></span></>}
        actions={
          <PermissionGate permission="orders.export">
            <Button icon={<DownloadOutlined />} onClick={async () => {
              try {
                const res = await axios.get('/orders/export-excel', { responseType: 'blob' });
                const url = window.URL.createObjectURL(new Blob([res.data]));
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', 'don-hang.xlsx');
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.URL.revokeObjectURL(url);
              } catch { message.error(t('orders.exportError')); }
            }}>{t('orders.exportBtn')}</Button>
          </PermissionGate>
        }
      />

      <div className="filters-bar">
        <Input className="filters-bar__search" placeholder={t('orders.searchPlaceholder')} prefix={<SearchOutlined style={{ color: "var(--text-muted)" }} />} value={search} onChange={(e) => setSearch(e.target.value)} allowClear />
        <Select placeholder={t('orders.statusPlaceholder')} style={{ width: 170 }} value={statusFilter} onChange={setStatusFilter} allowClear suffixIcon={<FilterOutlined />} options={["PENDING", "CONFIRMED", "SHIPPING", "COMPLETED", "CANCELLED"].map((s) => ({ value: s, label: STATUS_DICT[s]?.label || s }))} />
        <Select placeholder={t('orders.paymentPlaceholder')} style={{ width: 160 }} value={paymentFilter} onChange={setPaymentFilter} allowClear options={["PAID", "UNPAID", "PARTIAL"].map((s) => ({ value: s, label: STATUS_DICT[s]?.label || s }))} />
        <RangePicker value={dateRange} onChange={setDateRange} format="DD/MM/YYYY" placeholder={[t('orders.dateFrom'), t('orders.dateTo')]} />
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={filtered}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: (p) => setPage(p) }}
          locale={{ emptyText: <EmptyState title={t('orders.noResults')} description={t('orders.noResultsDesc')} /> }}
        />
      </div>

      <Drawer
        title={<span>{t('orders.detail')} <span style={{ fontFamily: "var(--font-mono)", color: "var(--primary)" }}>{detailData?.orderCode}</span></span>}
        width={620}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        extra={<Space><Button icon={<DownloadOutlined />} onClick={handleDownloadInvoice}>{t('orders.invoiceDownload')}</Button><Button icon={<PrinterOutlined />}>{t('orders.print')}</Button></Space>}
      >
        {detailLoading ? (
          <div style={{ display: "grid", placeItems: "center", padding: 60 }}><Spin /></div>
        ) : detailData ? (
          <>
            <Descriptions column={1} size="small" labelStyle={{ color: "var(--text-muted)", width: 120 }}>
              <Descriptions.Item label={t('orders.customerLabel')}>{detailData.customer?.name || t('orders.walkIn')}</Descriptions.Item>
              {detailData.customer?.phone && <Descriptions.Item label={t('orders.phoneLabel')}>{detailData.customer.phone}</Descriptions.Item>}
              <Descriptions.Item label={t('orders.statusLabel')}>
                <Space>
                  <StatusTag status={detailData.status} />
                  {canManage && (STATUS_TRANSITIONS[detailData.status]?.length > 0) && (
                    <PermissionGate permission="orders.edit">
                      <Dropdown
                        menu={{
                          items: STATUS_TRANSITIONS[detailData.status].map((s) => ({
                            key: s,
                            label: STATUS_DICT[s]?.label || s,
                            onClick: () => handleStatusUpdate(s),
                          })),
                        }}
                        trigger={["click"]}
                      >
                        <Button size="small" icon={<DownOutlined />}>
                          {t('orders.update')}
                        </Button>
                      </Dropdown>
                    </PermissionGate>
                  )}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label={t('orders.payment')}><StatusTag status={detailData.paymentStatus} /></Descriptions.Item>
              <Descriptions.Item label={t('orders.dateLabel')}>{formatDateTime(detailData.createdAt)}</Descriptions.Item>
            </Descriptions>

            <Divider />
            <SectionTitle>{t('orders.orderDetail')}</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(detailData.items || []).map((item) => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: 12, background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)" }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{item.product?.name || item.productName}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{item.quantity} x <MoneyDisplay value={item.price} /></div>
                  </div>
                  <strong><MoneyDisplay value={item.subtotal ?? Number(item.price) * item.quantity} /></strong>
                </div>
              ))}
            </div>

            <Divider />
            <Space style={{ marginBottom: 12 }}>
              <Button icon={<DollarOutlined />} onClick={() => setPaymentOpen(true)}>{t('orders.paymentRecord')}</Button>
              {detailData.status === "COMPLETED" && <Button icon={<UndoOutlined />} onClick={() => setReturnOpen(true)}>{t('orders.return')}</Button>}
            </Space>

            <SectionTitle>{t('orders.payment')}</SectionTitle>
            <StackList
              empty={t('orders.noPayments')}
              rows={(detailData.payments || []).map((payment) => ({
                id: payment.id,
                title: payment.method,
                meta: formatDateTime(payment.createdAt),
                amount: payment.amount,
              }))}
            />

            <Divider />
            <SectionTitle>{t('orders.return')}</SectionTitle>
            <StackList
              empty={t('orders.noReturns')}
              rows={(detailData.returns || []).map((ret) => ({
                id: ret.id,
                title: ret.returnCode,
                meta: ret.status,
                amount: ret.refundAmount,
              }))}
            />

            <Divider />
            <div style={{ background: "var(--bg-tertiary)", padding: 16, borderRadius: "var(--radius-md)" }}>
              <SummaryRow label={t('orders.subtotal')} value={detailData.subtotal} />
              <SummaryRow label={t('orders.discount')} value={detailData.discount} danger />
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, marginTop: 10, borderTop: "1px solid var(--border)" }}>
                <strong>{t('orders.grandTotal')}</strong>
                <span style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)" }}><MoneyDisplay value={detailData.total} /></span>
              </div>
            </div>

            {detailData.note && (
              <>
                <Divider />
                <SectionTitle>{t('orders.notes')}</SectionTitle>
                <div style={{ fontSize: 13, fontStyle: "italic" }}>{detailData.note}</div>
              </>
            )}
          </>
        ) : null}
      </Drawer>

      <Modal title={t('orders.paymentRecord')} open={paymentOpen} onCancel={() => setPaymentOpen(false)} onOk={handleRecordPayment} okText={t('orders.save')} cancelText={t('common.cancel')}>
        <Form form={paymentForm} layout="vertical" initialValues={{ method: "CASH" }}>
          <Form.Item name="amount" label={t('orders.amount')} rules={[{ required: true }]}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="method" label={t('orders.method')} rules={[{ required: true }]}><Select options={paymentOptions} /></Form.Item>
          <Form.Item name="reference" label={t('orders.transactionCode')}><Input /></Form.Item>
          <Form.Item name="note" label={t('orders.notes')}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal title={t('orders.returnCreate')} open={returnOpen} onCancel={() => setReturnOpen(false)} onOk={handleCreateReturn} okText={t('orders.create')} cancelText={t('common.cancel')}>
        <Form form={returnForm} layout="vertical" initialValues={{ refundMethod: "CASH" }}>
          <Form.Item name="orderItemId" label={t('orders.items')} rules={[{ required: true }]}>
            <Select
              options={(detailReturnable || []).map((item) => ({
                value: item.orderItemId,
                label: `${item.product?.name} (${t('orders.return')} ${item.returnable})`,
                disabled: item.returnable <= 0,
              }))}
            />
          </Form.Item>
          <Form.Item name="quantity" label={t('orders.returnQty')} rules={[{ required: true }]}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="refundMethod" label={t('orders.refundMethod')} rules={[{ required: true }]}>
            <Select options={[{ value: "CASH", label: t('orders.refundMethods.CASH') }, { value: "BANK_TRANSFER", label: t('orders.refundMethods.BANK_TRANSFER') }, { value: "STORE_CREDIT", label: t('orders.refundMethods.STORE_CREDIT') }]} />
          </Form.Item>
          <Form.Item name="reason" label={t('orders.reason')} rules={[{ required: true }]}>
            <Select
              options={[
                { value: "DEFECTIVE", label: t('orders.returnReasons.DEFECTIVE') },
                { value: "WRONG_ITEM", label: t('orders.returnReasons.WRONG_ITEM') },
                { value: "CUSTOMER_CHANGE", label: t('orders.returnReasons.CUSTOMER_CHANGE') },
                { value: "EXPIRED", label: t('orders.returnReasons.EXPIRED') },
                { value: "OTHER", label: t('orders.returnReasons.OTHER') },
              ]}
            />
          </Form.Item>
          <Form.Item name="note" label={t('orders.notes')}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function SectionTitle({ children }) {
  return <div style={{ marginBottom: 12, fontWeight: 500, fontSize: 13, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{children}</div>;
}

function StackList({ rows, empty }) {
  if (!rows.length) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{empty}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((row) => (
        <div key={row.id} style={{ display: "flex", justifyContent: "space-between", padding: 10, background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)" }}>
          <div><div style={{ fontWeight: 500 }}>{row.title}</div><div style={{ fontSize: 12, color: "var(--text-muted)" }}>{row.meta}</div></div>
          <MoneyDisplay value={row.amount} />
        </div>
      ))}
    </div>
  );
}

function SummaryRow({ label, value, danger }) {
  if (!Number(value || 0) && danger) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ color: danger ? "var(--danger-dark)" : undefined }}>{danger ? "- " : ""}<MoneyDisplay value={value} /></span>
    </div>
  );
}
