import { useEffect, useState, useCallback } from "react";
import { Table, Tag, Card, Statistic, Row, Col, message } from "antd";
import PageHeader from "../components/layout/PageHeader";
import { getDebts, getDebtsSummary } from "../api/debts";

const fmt = (v) => Number(v || 0).toLocaleString("vi-VN") + "đ";

export default function Debts() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ debts: [], pagination: { total: 0 } });
  const [summary, setSummary] = useState(null);
  const [filters, setFilters] = useState({ page: 1, limit: 20 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([getDebts(filters), getDebtsSummary().catch(() => null)]);
      setData(d);
      setSummary(s);
    } catch (e) {
      message.error(e.response?.data?.message || "Lỗi");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = [
    { title: "Loại", dataIndex: "type", width: 110 },
    { title: "Trạng thái", dataIndex: "status", width: 110, render: (s) => <Tag>{s}</Tag> },
    { title: "Số tiền", dataIndex: "amount", align: "right", render: fmt },
    { title: "Đã trả", dataIndex: "paidAmount", align: "right", render: fmt },
    { title: "Khách", render: (_, r) => r.customer?.name || "—" },
    { title: "NCC", render: (_, r) => r.vendor?.name || "—" },
    { title: "Đơn/PO", render: (_, r) => r.order?.orderCode || r.purchaseOrder?.poCode || "—" },
  ];

  return (
    <div>
      <PageHeader title="Công nợ" subtitle="Phải thu / phải trả (tổng quan)" />
      {summary && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={12} md={6}>
            <Card size="small">
              <Statistic title="Phải thu (mở)" value={summary.receivableOpenTotal} formatter={(v) => fmt(v)} />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card size="small">
              <Statistic title="Phải trả (mở)" value={summary.payableOpenTotal} formatter={(v) => fmt(v)} />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card size="small">
              <Statistic title="AR quá hạn" value={summary.receivableOverdue} formatter={(v) => fmt(v)} />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card size="small">
              <Statistic title="AP quá hạn" value={summary.payableOverdue} formatter={(v) => fmt(v)} />
            </Card>
          </Col>
        </Row>
      )}
      <Card size="small">
        <Table
          loading={loading}
          rowKey="id"
          dataSource={data.debts}
          columns={columns}
          pagination={{
            current: filters.page,
            pageSize: filters.limit,
            total: data.pagination.total,
            onChange: (page, limit) => setFilters({ ...filters, page, limit }),
          }}
        />
      </Card>
    </div>
  );
}
