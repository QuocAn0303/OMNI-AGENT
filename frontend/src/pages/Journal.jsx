// frontend/src/pages/Journal.jsx
// Sổ nhật ký + Hệ thống tài khoản
import { useEffect, useState } from "react";
import {
  Tabs, Table, Button, Modal, Form, Select, InputNumber, Input, DatePicker, Space, message, Tag, Card, Row, Col, Tree, Popconfirm,
} from "antd";
import { PlusOutlined, MinusCircleOutlined, RollbackOutlined, BankOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../components/layout/PageHeader";
import {
  getJournalEntries, createJournalEntry, reverseJournalEntry, recordCapitalContribution,
  getAccountTree, getAccounts,
} from "../api/accounting";

const fmtVND = (v) => Number(v || 0).toLocaleString("vi-VN") + "đ";
const SOURCE_LABELS = {
  ORDER: "Bán hàng", PAYMENT: "Thu tiền", RETURN: "Trả hàng", PURCHASE: "Mua hàng",
  EXPENSE: "Chi phí", PAYROLL: "Lương", BANK: "Ngân hàng", MANUAL: "Thủ công",
  OPENING_BALANCE: "Số dư đầu", ADJUSTMENT: "Điều chỉnh", INVENTORY: "Kho",
};

export default function Journal() {
  return (
    <div>
      <PageHeader title="Sổ kế toán" subtitle="Sổ nhật ký + Hệ thống tài khoản (Chart of Accounts)" />
      <Tabs
        defaultActiveKey="journal"
        items={[
          { key: "journal", label: "Sổ nhật ký", children: <JournalListTab /> },
          { key: "coa", label: "Hệ thống tài khoản (COA)", children: <COATab /> },
        ]}
      />
    </div>
  );
}

function JournalListTab() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ entries: [], pagination: { total: 0 } });
  const [filters, setFilters] = useState({ page: 1, limit: 50 });
  const [showCreate, setShowCreate] = useState(false);
  const [showCapital, setShowCapital] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [form] = Form.useForm();
  const [capitalForm] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try { setData(await getJournalEntries(filters)); }
    catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [filters]);
  useEffect(() => { getAccounts().then(setAccounts).catch(() => {}); }, []);

  const submitCreate = async () => {
    try {
      const v = await form.validateFields();
      await createJournalEntry({
        ...v,
        date: v.date ? v.date.toISOString() : undefined,
        lines: v.lines.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
          description: l.description,
        })),
      });
      message.success("Đã ghi sổ");
      setShowCreate(false);
      form.resetFields();
      load();
    } catch (e) {
      if (e.errorFields) return;
      message.error(e.response?.data?.message || "Lỗi");
    }
  };

  const submitCapital = async () => {
    try {
      const v = await capitalForm.validateFields();
      await recordCapitalContribution(v);
      message.success("Đã ghi nhận góp vốn");
      setShowCapital(false);
      capitalForm.resetFields();
      load();
    } catch (e) {
      if (e.errorFields) return;
      message.error(e.response?.data?.message || "Lỗi");
    }
  };

  const handleReverse = async (id) => {
    try { await reverseJournalEntry(id); message.success("Đã đảo bút toán"); load(); }
    catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
  };

  const columns = [
    { title: "Mã", dataIndex: "entryCode", width: 160 },
    { title: "Ngày", dataIndex: "date", width: 110, render: (d) => dayjs(d).format("DD/MM/YYYY") },
    { title: "Nguồn", dataIndex: "source", width: 110, render: (s) => <Tag>{SOURCE_LABELS[s] || s}</Tag> },
    { title: "Diễn giải", dataIndex: "description", ellipsis: true },
    {
      title: "Tổng", width: 140, align: "right",
      render: (_, r) => fmtVND(r.lines.reduce((s, l) => s + Number(l.debit || 0), 0)),
    },
    { title: "Trạng thái", dataIndex: "status", width: 110, render: (s) => <Tag color={s === "POSTED" ? "green" : s === "REVERSED" ? "red" : "default"}>{s}</Tag> },
    {
      title: "", key: "actions", width: 130, fixed: "right",
      render: (_, r) => (
        r.status === "POSTED" && r.source === "MANUAL" ? (
          <Popconfirm title="Đảo bút toán này?" onConfirm={() => handleReverse(r.id)}>
            <Button type="link" size="small" icon={<RollbackOutlined />} danger>Đảo</Button>
          </Popconfirm>
        ) : null
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowCreate(true)}>Ghi sổ thủ công</Button>
        <Button icon={<BankOutlined />} onClick={() => setShowCapital(true)}>Ghi góp vốn</Button>
      </Space>

      <Table
        loading={loading}
        rowKey="id"
        dataSource={data.entries}
        columns={columns}
        scroll={{ x: 1100 }}
        expandable={{
          expandedRowRender: (r) => (
            <Card size="small">
              <Table
                size="small"
                pagination={false}
                rowKey="id"
                dataSource={r.lines}
                columns={[
                  { title: "TK", render: (_, l) => `${l.account.code} - ${l.account.nameVi}` },
                  { title: "Diễn giải", dataIndex: "description", ellipsis: true },
                  { title: "Nợ", dataIndex: "debit", align: "right", width: 140, render: (v) => Number(v) > 0 ? fmtVND(v) : "—" },
                  { title: "Có", dataIndex: "credit", align: "right", width: 140, render: (v) => Number(v) > 0 ? fmtVND(v) : "—" },
                ]}
              />
            </Card>
          ),
        }}
        pagination={{
          current: filters.page,
          pageSize: filters.limit,
          total: data.pagination.total,
          onChange: (page, limit) => setFilters({ ...filters, page, limit }),
        }}
      />

      {/* Modal ghi sổ thủ công */}
      <Modal
        title="Ghi sổ thủ công (manual journal entry)"
        open={showCreate}
        onOk={submitCreate}
        onCancel={() => setShowCreate(false)}
        width={900}
        okText="Ghi sổ"
        cancelText="Hủy"
      >
        <Form form={form} layout="vertical" initialValues={{ date: dayjs(), lines: [{}, {}] }}>
          <Row gutter={12}>
            <Col span={6}>
              <Form.Item label="Ngày" name="date" rules={[{ required: true }]}>
                <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={18}>
              <Form.Item label="Diễn giải" name="description" rules={[{ required: true }]}>
                <Input placeholder="Vd: Phân bổ chi phí khấu hao tháng 5" />
              </Form.Item>
            </Col>
          </Row>

          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 8, fontWeight: 600 }}>Các dòng bút toán (Nợ = Có)</div>
                {fields.map(({ key, name, ...rest }) => (
                  <Space key={key} align="baseline" style={{ display: "flex", marginBottom: 8 }}>
                    <Form.Item {...rest} name={[name, "accountId"]} rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                      <Select showSearch optionFilterProp="label" placeholder="Tài khoản" style={{ width: 280 }}
                        options={accounts.map((a) => ({ value: a.id, label: `${a.code} - ${a.nameVi}` }))} />
                    </Form.Item>
                    <Form.Item {...rest} name={[name, "debit"]} style={{ marginBottom: 0 }}>
                      <InputNumber min={0} placeholder="Nợ" style={{ width: 140 }}
                        formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} parser={(v) => v.replace(/,/g, "")} />
                    </Form.Item>
                    <Form.Item {...rest} name={[name, "credit"]} style={{ marginBottom: 0 }}>
                      <InputNumber min={0} placeholder="Có" style={{ width: 140 }}
                        formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} parser={(v) => v.replace(/,/g, "")} />
                    </Form.Item>
                    <Form.Item {...rest} name={[name, "description"]} style={{ marginBottom: 0 }}>
                      <Input placeholder="Diễn giải dòng" style={{ width: 220 }} />
                    </Form.Item>
                    {fields.length > 2 && <MinusCircleOutlined onClick={() => remove(name)} />}
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />}>Thêm dòng</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* Modal góp vốn */}
      <Modal
        title="Ghi nhận góp vốn"
        open={showCapital}
        onOk={submitCapital}
        onCancel={() => setShowCapital(false)}
        okText="Ghi nhận"
        cancelText="Hủy"
      >
        <Form form={capitalForm} layout="vertical" initialValues={{ method: "BANK_TRANSFER" }}>
          <Form.Item label="Số tiền góp vốn" name="amount" rules={[{ required: true, type: "number", min: 1 }]}>
            <InputNumber style={{ width: "100%" }}
              formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} parser={(v) => v.replace(/,/g, "")} />
          </Form.Item>
          <Form.Item label="Phương thức" name="method">
            <Select options={[
              { value: "CASH", label: "Tiền mặt" },
              { value: "BANK_TRANSFER", label: "Chuyển khoản" },
            ]} />
          </Form.Item>
          <Form.Item label="Mô tả" name="description">
            <Input placeholder="Vd: Founder A góp vốn ban đầu" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function COATab() {
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getAccountTree()
      .then((d) => setTree(d.map(toTreeNode)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card loading={loading} title="Hệ thống tài khoản theo VAS rút gọn">
      <Tree treeData={tree} defaultExpandAll showLine />
    </Card>
  );
}

function toTreeNode(acc) {
  return {
    key: acc.id,
    title: <span><b>{acc.code}</b> — {acc.nameVi} <Tag style={{ marginLeft: 8 }}>{acc.type}</Tag></span>,
    children: acc.children?.map(toTreeNode),
  };
}
