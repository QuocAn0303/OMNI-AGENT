/**
 * Frontend: pages/Expenses.jsx — Quản lý chi phí
 * 
 * Tổng quan:
 * - Danh sách chi phí (getExpenses) với phân trang, lọc theo trạng thái
 * - Tạo chi phí mới qua modal (createExpense), có thể gắn NCC, category, dự án, VAT
 * - Duyệt (approveExpense), thanh toán (payExpense), từ chối (rejectExpense)
 * - Load danh sách expense categories, vendors, tax rates, projects khi mount
 * - State: data/loading/filters tự quản lý, form dùng Ant Design Form
 * 
 * Components/Hooks/Exports:
 * - Expenses (default): Page chính — table + summary stats + modal tạo
 */
import { useEffect, useState } from "react";
import {
  Table, Button, Modal, Form, Input, Select, InputNumber, DatePicker,
  Tag, Space, message, Card, Row, Col, Statistic, Popconfirm,
} from "antd";
import { PlusOutlined, CheckOutlined, DollarOutlined, CloseOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../components/layout/PageHeader";

import axios from "../api/axios";
import {
  getExpenses, createExpense, approveExpense, payExpense, rejectExpense,
  getExpenseCategories, getVendors, getTaxRates,
} from "../api/accounting";

const STATUS_COLORS = {
  DRAFT: "default",
  PENDING_APPROVAL: "blue",
  APPROVED: "cyan",
  PAID: "green",
  REJECTED: "red",
};
const STATUS_LABEL = {
  DRAFT: "Nháp",
  PENDING_APPROVAL: "Chờ duyệt",
  APPROVED: "Đã duyệt - Chưa trả",
  PAID: "Đã thanh toán",
  REJECTED: "Từ chối",
};

const fmtVND = (v) => Number(v || 0).toLocaleString("vi-VN") + "đ";

export default function Expenses() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ expenses: [], summary: { totalAmount: 0 }, pagination: { total: 0 } });
  const [filters, setFilters] = useState({ page: 1, limit: 20, status: undefined });
  const [showCreate, setShowCreate] = useState(false);
  const [categories, setCategories] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [projects, setProjects] = useState([]);
  const [taxRates, setTaxRates] = useState([]);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res = await getExpenses(filters);
      setData(res);
    } catch (e) {
      message.error(e.response?.data?.message || "Không tải được");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filters]);
  useEffect(() => {
    Promise.all([getExpenseCategories(), getVendors({ limit: 100 }), getTaxRates()])
      .then(([c, v, t]) => {
        setCategories(c || []);
        setVendors(v?.vendors || []);
        setTaxRates(t || []);
      })
      .catch(() => {});
    // Load active projects để hiển thị trong picker (chỉ chọn project ACTIVE/DRAFT)
    axios.get('/projects', { params: { limit: 200, status: 'ACTIVE' } })
      .then((res) => setProjects(res.data?.data || []))
      .catch(() => {});
  }, []);

  const submitCreate = async () => {
    try {
      const v = await form.validateFields();
      const payload = {
        ...v,
        date: v.date ? v.date.toISOString() : undefined,
        amount: Number(v.amount),
      };
      await createExpense(payload);
      message.success("Đã tạo chi phí");
      setShowCreate(false);
      form.resetFields();
      load();
    } catch (e) {
      if (e.errorFields) return;
      message.error(e.response?.data?.message || "Lỗi");
    }
  };

  const handleApprove = async (id) => {
    try { await approveExpense(id); message.success("Đã duyệt"); load(); }
    catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
  };
  const handlePay = async (id) => {
    try { await payExpense(id, {}); message.success("Đã thanh toán"); load(); }
    catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
  };
  const handleReject = async (id) => {
    try { await rejectExpense(id); message.success("Đã từ chối"); load(); }
    catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
  };

  const columns = [
    { title: "Mã", dataIndex: "expenseCode", width: 150 },
    { title: "Ngày", dataIndex: "date", width: 110, render: (d) => dayjs(d).format("DD/MM/YYYY") },
    { title: "Loại", dataIndex: ["category", "name"], width: 180 },
    { title: "Mô tả", dataIndex: "description", ellipsis: true },
    { title: "NCC", dataIndex: ["vendor", "name"], width: 180 },
    { title: "Số tiền", dataIndex: "totalAmount", width: 120, align: "right", render: fmtVND },
    {
      title: "Trạng thái", dataIndex: "status", width: 160,
      render: (s) => <Tag color={STATUS_COLORS[s]}>{STATUS_LABEL[s]}</Tag>,
    },
    {
      title: "", key: "actions", width: 200, fixed: "right",
      render: (_, r) => (
        <Space>
          {(r.status === "DRAFT" || r.status === "PENDING_APPROVAL") && (
            <>
              <Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleApprove(r.id)}>Duyệt</Button>
              <Popconfirm title="Từ chối?" onConfirm={() => handleReject(r.id)}>
                <Button type="link" size="small" danger icon={<CloseOutlined />}>Từ chối</Button>
              </Popconfirm>
            </>
          )}
          {r.status === "APPROVED" && (
            <Popconfirm title="Đánh dấu đã thanh toán?" onConfirm={() => handlePay(r.id)}>
              <Button type="link" size="small" icon={<DollarOutlined />}>Trả tiền</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Quản lý chi phí"
        subtitle="Ghi nhận chi phí phát sinh - hệ thống tự động hạch toán"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setShowCreate(true)}>Thêm chi phí</Button>}
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card><Statistic title="Tổng chi phí (filter)" value={data.summary.totalAmount} formatter={fmtVND} /></Card>
        </Col>
        <Col xs={24} md={8}>
          <Card><Statistic title="Số phiếu" value={data.pagination.total} /></Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Select
              allowClear
              style={{ width: "100%" }}
              placeholder="Lọc trạng thái"
              value={filters.status}
              onChange={(v) => setFilters({ ...filters, status: v, page: 1 })}
              options={Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: k, label: v }))}
            />
          </Card>
        </Col>
      </Row>

      <Table
        loading={loading}
        rowKey="id"
        dataSource={data.expenses}
        columns={columns}
        scroll={{ x: 1200 }}
        pagination={{
          current: filters.page,
          pageSize: filters.limit,
          total: data.pagination.total,
          onChange: (page, limit) => setFilters({ ...filters, page, limit }),
        }}
      />

      <Modal
        title="Thêm chi phí mới"
        open={showCreate}
        onOk={submitCreate}
        onCancel={() => setShowCreate(false)}
        width={680}
        okText="Lưu"
        cancelText="Hủy"
      >
        <Form form={form} layout="vertical" initialValues={{ paymentMethod: "BANK_TRANSFER", status: "PAID", date: dayjs() }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Ngày" name="date" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Loại chi phí" name="categoryId" rules={[{ required: true }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={categories.map((c) => ({ value: c.id, label: `${c.code} - ${c.name}` }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Mô tả" name="description" rules={[{ required: true, min: 2 }]}>
            <Input placeholder="Vd: Thuê mặt bằng tháng 5" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Số tiền (chưa VAT)" name="amount" rules={[{ required: true, type: "number", min: 1 }]}>
                <InputNumber style={{ width: "100%" }} formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} parser={(v) => v.replace(/,/g, "")} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Thuế VAT" name="taxRateId">
                <Select allowClear options={taxRates.map((t) => ({ value: t.id, label: t.name }))} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Nhà cung cấp (tùy chọn)" name="vendorId">
                <Select allowClear showSearch optionFilterProp="label" options={vendors.map((v) => ({ value: v.id, label: v.name }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Dự án (tùy chọn)" name="projectId">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="Gắn chi phí vào dự án để theo dõi Budget vs Actual"
                  options={projects.map((p) => ({
                    value: p.id,
                    label: `${p.code} - ${p.name}`,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Phương thức" name="paymentMethod">
                <Select options={[
                  { value: "CASH", label: "Tiền mặt" },
                  { value: "BANK_TRANSFER", label: "Chuyển khoản" },
                  { value: "CARD", label: "Thẻ" },
                ]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Trạng thái" name="status">
                <Select options={[
                  { value: "DRAFT", label: "Nháp" },
                  { value: "APPROVED", label: "Duyệt" },
                  { value: "PAID", label: "Đã trả" },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Số hóa đơn (đầu vào)" name="invoiceNumber">
            <Input placeholder="VD: 0001234" />
          </Form.Item>
          <Form.Item label="Ghi chú" name="note">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
