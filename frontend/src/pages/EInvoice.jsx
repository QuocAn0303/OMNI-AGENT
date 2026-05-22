// frontend/src/pages/EInvoice.jsx
import { useState, useEffect, useCallback } from "react";
import { Table, Tag, Button, Space, Select, DatePicker, message, Tooltip, Modal, Descriptions } from "antd";
import { ReloadOutlined, CheckCircleOutlined, StopOutlined, SyncOutlined, EyeOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../components/layout/PageHeader";
import { getEInvoices, getEInvoice, cancelEInvoice, syncEInvoice, issueEInvoice } from "../api/einvoice";

const { RangePicker } = DatePicker;

const STATUS_COLOR = {
  PENDING: "processing",
  SIGNED: "blue",
  SENT: "cyan",
  ACCEPTED: "success",
  REJECTED: "error",
  CANCELLED: "default",
};

const fmtVND = (v) => Number(v || 0).toLocaleString("vi-VN") + "đ";

export default function EInvoice() {
  const [data, setData]           = useState({ items: [], pagination: {} });
  const [loading, setLoading]     = useState(false);
  const [filters, setFilters]     = useState({ page: 1, limit: 20 });
  const [detail, setDetail]       = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const load = useCallback(async (f = filters) => {
    setLoading(true);
    try {
      const params = { ...f };
      if (params.dateRange) {
        params.from = params.dateRange[0].toISOString();
        params.to   = params.dateRange[1].toISOString();
        delete params.dateRange;
      }
      const res = await getEInvoices(params);
      setData(res);
    } catch (e) {
      message.error(e?.response?.data?.message || "Không tải được dữ liệu");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, []);

  const handleCancel = async (id) => {
    try {
      await cancelEInvoice(id);
      message.success("Đã hủy hóa đơn");
      load();
    } catch (e) { message.error(e?.response?.data?.message || "Lỗi hủy hóa đơn"); }
  };

  const handleSync = async (id) => {
    try {
      await syncEInvoice(id);
      message.success("Đã đồng bộ trạng thái");
      load();
    } catch (e) { message.error(e?.response?.data?.message || "Lỗi đồng bộ"); }
  };

  const openDetail = async (id) => {
    try {
      const inv = await getEInvoice(id);
      setDetail(inv);
      setDetailOpen(true);
    } catch (e) { message.error("Không tải được chi tiết"); }
  };

  const cols = [
    { title: "Số HĐ", dataIndex: "invoiceNo", width: 150 },
    { title: "Ký hiệu", dataIndex: "serial", width: 100 },
    { title: "Ngày phát hành", dataIndex: "issueDate", width: 140,
      render: (v) => v ? dayjs(v).format("DD/MM/YYYY HH:mm") : "—" },
    { title: "Người mua", dataIndex: "buyerName", ellipsis: true },
    { title: "MST người mua", dataIndex: "buyerTaxCode", width: 140 },
    { title: "Đơn hàng", key: "order", width: 140,
      render: (_, r) => r.order?.orderCode || "—" },
    { title: "Tổng tiền", key: "total", width: 130, align: "right",
      render: (_, r) => fmtVND(r.order?.total) },
    { title: "Trạng thái CQT", dataIndex: "cqtStatus", width: 130,
      render: (v) => <Tag color={STATUS_COLOR[v] || "default"}>{v}</Tag> },
    { title: "Mã CQT", dataIndex: "cqtCode", width: 160 },
    { title: "Nhà cung cấp", dataIndex: "provider", width: 90 },
    {
      title: "Thao tác", key: "action", width: 130, fixed: "right",
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="Xem chi tiết">
            <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(r.id)} />
          </Tooltip>
          <Tooltip title="Đồng bộ trạng thái">
            <Button size="small" icon={<SyncOutlined />} onClick={() => handleSync(r.id)} />
          </Tooltip>
          {r.cqtStatus !== "CANCELLED" && (
            <Tooltip title="Hủy hóa đơn">
              <Button size="small" danger icon={<StopOutlined />}
                onClick={() => Modal.confirm({
                  title: "Hủy hóa đơn điện tử?",
                  content: `Số HĐ: ${r.invoiceNo}`,
                  onOk: () => handleCancel(r.id),
                })} />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Hóa đơn điện tử"
        subtitle="Quản lý HĐĐT phát hành theo NĐ123/TT78"
      />

      {/* Filters */}
      <Space style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <Select
          placeholder="Trạng thái CQT"
          allowClear style={{ width: 160 }}
          onChange={(v) => setFilters((f) => ({ ...f, cqtStatus: v, page: 1 }))}
          options={[
            { value: "PENDING",   label: "Chờ xử lý" },
            { value: "ACCEPTED",  label: "CQT chấp nhận" },
            { value: "REJECTED",  label: "CQT từ chối" },
            { value: "CANCELLED", label: "Đã hủy" },
          ]}
        />
        <RangePicker
          format="DD/MM/YYYY"
          onChange={(v) => setFilters((f) => ({ ...f, dateRange: v, page: 1 }))}
        />
        <Button
          type="primary" icon={<ReloadOutlined />}
          onClick={() => load({ ...filters, page: 1 })}
          loading={loading}
        >
          Tải lại
        </Button>
      </Space>

      <Table
        rowKey="id"
        columns={cols}
        dataSource={data.items || []}
        loading={loading}
        scroll={{ x: 1400 }}
        pagination={{
          current: data.pagination?.page,
          pageSize: data.pagination?.limit,
          total: data.pagination?.total,
          showSizeChanger: true,
          showTotal: (t) => `${t} hóa đơn`,
          onChange: (page, pageSize) => {
            const f = { ...filters, page, limit: pageSize };
            setFilters(f);
            load(f);
          },
        }}
      />

      {/* Detail modal */}
      <Modal
        open={detailOpen}
        title={`Chi tiết HĐĐT: ${detail?.invoiceNo}`}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={700}
      >
        {detail && (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="Số HĐ">{detail.invoiceNo}</Descriptions.Item>
            <Descriptions.Item label="Ký hiệu">{detail.serial}</Descriptions.Item>
            <Descriptions.Item label="Mẫu HĐ">{detail.templateCode}</Descriptions.Item>
            <Descriptions.Item label="Ngày phát hành">
              {dayjs(detail.issueDate).format("DD/MM/YYYY HH:mm")}
            </Descriptions.Item>
            <Descriptions.Item label="Người mua" span={2}>{detail.buyerName}</Descriptions.Item>
            <Descriptions.Item label="MST người mua">{detail.buyerTaxCode || "—"}</Descriptions.Item>
            <Descriptions.Item label="Địa chỉ người mua">{detail.buyerAddress || "—"}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái CQT">
              <Tag color={STATUS_COLOR[detail.cqtStatus]}>{detail.cqtStatus}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Mã CQT">{detail.cqtCode || "—"}</Descriptions.Item>
            <Descriptions.Item label="Nhà cung cấp">{detail.provider}</Descriptions.Item>
            <Descriptions.Item label="Đơn hàng">
              {detail.order?.orderCode || "—"} — {fmtVND(detail.order?.total)}
            </Descriptions.Item>
            {detail.pdfUrl && (
              <Descriptions.Item label="PDF" span={2}>
                <a href={detail.pdfUrl} target="_blank" rel="noreferrer">Tải PDF</a>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}
