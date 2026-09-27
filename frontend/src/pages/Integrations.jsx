/**
 * Frontend: pages/Integrations.jsx — Trung tâm tích hợp & API keys
 * 
 * Tổng quan:
 * - Quản lý credentials cho các dịch vụ ngoài: VNPT (HĐĐT), Cloudinary, SMS Gateway, SMTP Email
 * - Mỗi danh mục (CategoryPanel) tải cấu hình từ GET /integrations/{key}, lưu qua PUT, test kết nối qua POST /{key}/test
 * - Secrets được mã hóa AES-256-GCM trong DB, hiển thị masked
 * - Nếu bỏ trống field = giữ nguyên giá trị cũ (chỉ cập nhật field có giá trị)
 * - State: mỗi CategoryPanel tự quản lý data/loading/saving/testing
 * 
 * Components/Hooks/Exports:
 * - Integrations (default): Page chính — Tabs cho từng danh mục
 * - CategoryPanel: Component con — form cấu hình + test connection
 */
import { useState, useEffect } from 'react';
import {
  Card, Tabs, Form, Input, InputNumber, Button, Space, Tag, Alert, message, Typography, Divider, Tooltip,
  Table, Modal, Select, Switch, Popconfirm,
} from "antd";
import {
  ApiOutlined, CloudUploadOutlined, MessageOutlined, MailOutlined,
  CheckCircleOutlined, EyeInvisibleOutlined, ThunderboltOutlined, SaveOutlined,
  LinkOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  BankOutlined, KeyOutlined,
} from "@ant-design/icons";
import PlanGate from '../components/PlanGate';
import axios from "../api/axios";
import useToast from '../components/shared/useToast';
import useConfirm from '../components/shared/useConfirm';

const { Title, Text, Paragraph } = Typography;
const MASK = "••••••••";

const WEBHOOK_EVENTS = [
  { value: 'order.created', label: 'Đơn hàng được tạo' },
  { value: 'order.completed', label: 'Đơn hàng hoàn thành' },
  { value: 'order.cancelled', label: 'Đơn hàng bị hủy' },
  { value: 'payment.paid', label: 'Thanh toán thành công' },
  { value: 'inventory.low_stock', label: 'Cảnh báo tồn kho thấp' },
  { value: 'customer.created', label: 'Khách hàng mới' },
  { value: 'debt.overdue', label: 'Công nợ quá hạn' },
];

function WebhooksPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/webhooks');
      setEndpoints(res.data?.data || []);
    } catch {
      toast.error('Không tải được danh sách webhook');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openModal = (ep = null) => {
    setEditing(ep);
    form.setFieldsValue(ep ? { url: ep.url, secret: ep.secret, events: ep.events } : { events: ['order.created'] });
    setModalOpen(true);
  };

  const onSave = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await axios.patch(`/webhooks/${editing.id}`, values);
        toast.success('Cập nhật webhook thành công');
      } else {
        await axios.post('/webhooks', values);
        toast.success('Tạo webhook thành công');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      if (err.errorFields) return;
      toast.error(err?.response?.data?.message || 'Lưu thất bại');
    }
  };

  const onDelete = (id) => {
    confirm.deleteConfirm({
      title: 'Xóa webhook?',
      content: 'Webhook sẽ ngừng gửi event tới endpoint này.',
      onOk: async () => {
        try {
          await axios.delete(`/webhooks/${id}`);
          toast.success('Đã xóa webhook');
          load();
        } catch {
          toast.error('Xóa thất bại');
        }
      },
    });
  };

  return (
    <div>
      <Alert
        type="info"
        showIcon
        message="Webhook cho phép bên thứ 3 nhận event từ hệ thống (order.created, payment.paid, ...). Mỗi request được ký bằng HMAC-SHA256 trong header X-Webhook-Signature."
        style={{ marginBottom: 16 }}
      />
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
          Thêm webhook
        </Button>
      </div>
      <Table
        dataSource={endpoints}
        rowKey="id"
        loading={loading}
        pagination={false}
        columns={[
          { title: 'URL', dataIndex: 'url', ellipsis: true },
          { title: 'Sự kiện', dataIndex: 'events', render: (events) => (
            <Space wrap>
              {(events || []).map((e) => {
                const def = WEBHOOK_EVENTS.find((w) => w.value === e);
                return <Tag key={e} color="blue">{def?.label || e}</Tag>;
              })}
            </Space>
          ) },
          { title: 'Trạng thái', dataIndex: 'isActive', render: (v) => v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag> },
          { title: '', width: 100, align: 'right', render: (_, row) => (
            <Space>
              <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openModal(row)} />
              <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(row.id)} />
            </Space>
          ) },
        ]}
      />
      <Modal
        title={editing ? 'Sửa webhook' : 'Thêm webhook'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={onSave}
        okText="Lưu"
        cancelText="Hủy"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="URL" name="url" rules={[{ required: true, type: 'url', message: 'URL không hợp lệ' }]}>
            <Input placeholder="https://your-app.com/webhooks/aduu" />
          </Form.Item>
          <Form.Item label="Secret" name="secret" rules={[{ required: true, min: 8, message: 'Secret tối thiểu 8 ký tự' }]}>
            <Input.Password placeholder="Dùng để verify HMAC-SHA256" />
          </Form.Item>
          <Form.Item label="Sự kiện" name="events" rules={[{ required: true, message: 'Chọn ít nhất 1 sự kiện' }]}>
            <Select mode="multiple" placeholder="Chọn sự kiện" options={WEBHOOK_EVENTS} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function BankAccountsPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [pendingSave, setPendingSave] = useState(null);
  const [passwordForm] = Form.useForm();
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/bank-accounts');
      setAccounts(res.data?.data || []);
    } catch {
      toast.error('Không tải được danh sách tài khoản ngân hàng');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openModal = (acc = null) => {
    setEditing(acc);
    if (acc) {
      form.setFieldsValue({
        accountNumber: acc.accountNumber,
        bankName: acc.bankName,
        accountName: acc.accountName,
        openingBalance: acc.openingBalance,
        isDefault: acc.isDefault,
        note: acc.note,
      });
    } else {
      form.resetFields();
    }
    setModalOpen(true);
  };

  const confirmPassword = async () => {
    try {
      const values = await passwordForm.validateFields();
      await axios.post('/auth/verify-password', { password: values.password });
      setPasswordModalOpen(false);
      passwordForm.resetFields();
      const action = pendingSave;
      setPendingSave(null);
      if (action) await action();
      load();
    } catch (err) {
      if (err.errorFields) return;
      toast.error(err?.response?.data?.message || 'Mật khẩu không đúng');
    }
  };

  const onSave = async () => {
    try {
      const values = await form.validateFields();
      const doSave = async () => {
        if (editing) {
          await axios.put(`/bank-accounts/${editing.id}`, values);
          toast.success('Cập nhật tài khoản ngân hàng thành công');
        } else {
          await axios.post('/bank-accounts', values);
          toast.success('Thêm tài khoản ngân hàng thành công');
        }
        setModalOpen(false);
      };
      setPendingSave(() => doSave);
      setPasswordModalOpen(true);
    } catch (err) {
      if (err.errorFields) return;
      toast.error(err?.response?.data?.message || 'Lưu thất bại');
    }
  };

  const onDelete = (id) => {
    confirm.deleteConfirm({
      title: 'Xóa tài khoản ngân hàng?',
      content: 'Tài khoản sẽ bị ẩn và không còn sử dụng được.',
      onOk: async () => {
        const doDelete = async () => {
          await axios.delete(`/bank-accounts/${id}`);
          toast.success('Đã xóa tài khoản ngân hàng');
          load();
        };
        setPendingSave(() => doDelete);
        setPasswordModalOpen(true);
      },
    });
  };

  return (
    <div>
      <Alert
        type="info"
        showIcon
        message="Quản lý tài khoản ngân hàng của doanh nghiệp. Các thay đổi cần xác thực mật khẩu để đảm bảo an toàn."
        style={{ marginBottom: 16 }}
      />
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
          Thêm tài khoản ngân hàng
        </Button>
      </div>
      <Table
        dataSource={accounts}
        rowKey="id"
        loading={loading}
        pagination={false}
        columns={[
          { title: 'Ngân hàng', dataIndex: 'bankName' },
          { title: 'Số tài khoản', dataIndex: 'accountNumber' },
          { title: 'Chủ tài khoản', dataIndex: 'accountName' },
          {
            title: 'Số dư', dataIndex: 'currentBalance',
            render: (v) => (Number(v || 0)).toLocaleString('vi-VN', { style: 'currency', currency: 'VND' }),
          },
          { title: 'Mặc định', dataIndex: 'isDefault', render: (v) => v ? <Tag color="green">Có</Tag> : '-' },
          {
            title: '', width: 100, align: 'right',
            render: (_, row) => (
              <Space>
                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openModal(row)} />
                <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(row.id)} />
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editing ? 'Sửa tài khoản ngân hàng' : 'Thêm tài khoản ngân hàng'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={onSave}
        okText="Lưu"
        cancelText="Hủy"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="Tên ngân hàng" name="bankName" rules={[{ required: true, message: 'Nhập tên ngân hàng' }]}>
            <Input placeholder="Vietcombank" />
          </Form.Item>
          <Form.Item label="Số tài khoản" name="accountNumber" rules={[{ required: true, message: 'Nhập số tài khoản' }]}>
            <Input placeholder="1234567890" />
          </Form.Item>
          <Form.Item label="Chủ tài khoản" name="accountName" rules={[{ required: true, message: 'Nhập tên chủ tài khoản' }]}>
            <Input placeholder="CÔNG TY TNHH ADUU" />
          </Form.Item>
          <Form.Item label="Số dư đầu kỳ" name="openingBalance">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Mặc định" name="isDefault" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="Ghi chú" name="note">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={<Space><KeyOutlined />Xác thực mật khẩu</Space>}
        open={passwordModalOpen}
        onCancel={() => { setPasswordModalOpen(false); setPendingSave(null); passwordForm.resetFields(); }}
        onOk={confirmPassword}
        okText="Xác thực"
        cancelText="Hủy"
      >
        <Alert
          type="warning"
          showIcon
          message="Vui lòng nhập mật khẩu để xác nhận thay đổi tài khoản ngân hàng."
          style={{ marginBottom: 16 }}
        />
        <Form form={passwordForm} layout="vertical">
          <Form.Item label="Mật khẩu" name="password" rules={[{ required: true, message: 'Nhập mật khẩu' }]}>
            <Input.Password autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

const CATEGORIES = [
  {
    key: "VNPT",
    label: "Hóa đơn điện tử (VNPT)",
    icon: <ApiOutlined />,
    description: "Cấu hình để phát hành hóa đơn điện tử qua VNPT. Bỏ trống → chạy mock mode (sandbox).",
    fields: [
      { name: "VNPT_EINVOICE_URL", label: "API URL", placeholder: "https://einvoiceapi.vnpt.vn" },
      { name: "VNPT_USERNAME", label: "Username" },
      { name: "VNPT_PASSWORD", label: "Password", secret: true },
      { name: "VNPT_COM_CODE", label: "Mã công ty (com_code)" },
      { name: "VNPT_TEMPLATE_CODE", label: "Mẫu số HĐ", placeholder: "1/001" },
      { name: "VNPT_SERIAL", label: "Ký hiệu HĐ", placeholder: "K24TVE" },
    ],
    test: { requiresInput: false, label: "Test đăng nhập VNPT" },
  },
  {
    key: "CLOUDINARY",
    label: "Cloudinary (upload ảnh)",
    icon: <CloudUploadOutlined />,
    description: "Lưu ảnh sản phẩm và file hóa đơn PDF. Bỏ trống → upload tạm vào RAM (không lưu vĩnh viễn).",
    fields: [
      { name: "CLOUDINARY_CLOUD_NAME", label: "Cloud name" },
      { name: "CLOUDINARY_API_KEY", label: "API Key", secret: true },
      { name: "CLOUDINARY_API_SECRET", label: "API Secret", secret: true },
    ],
    test: { requiresInput: false, label: "Test kết nối Cloudinary" },
  },
  {
    key: "SMS",
    label: "SMS Gateway (OTP Portal)",
    icon: <MessageOutlined />,
    description: "Gửi OTP cho Customer Portal. Bỏ trống → log OTP ra console (chỉ dùng dev).",
    fields: [
      { name: "SMS_PROVIDER", label: "Provider", placeholder: "ESMS / TWILIO / LOG" },
      { name: "SMS_API_KEY", label: "API Key / Account SID", secret: true },
      { name: "SMS_API_SECRET", label: "API Secret / Auth Token", secret: true },
      { name: "SMS_BRAND_NAME", label: "Brandname / From" },
    ],
    test: {
      requiresInput: true,
      inputName: "testPhone",
      inputLabel: "Số điện thoại test",
      inputPlaceholder: "0912xxxxxx",
      label: "Gửi SMS test",
    },
  },
  {
    key: "EMAIL",
    label: "SMTP Email",
    icon: <MailOutlined />,
    description: "Gửi email campaign + notification. Bỏ trống → log nội dung ra console.",
    fields: [
      { name: "SMTP_HOST", label: "Host", placeholder: "smtp.gmail.com" },
      { name: "SMTP_PORT", label: "Port", placeholder: "587" },
      { name: "SMTP_USER", label: "Username" },
      { name: "SMTP_PASS", label: "Password / App Password", secret: true },
      { name: "SMTP_FROM", label: "From address", placeholder: "no-reply@aduu.vn" },
      { name: "SMTP_SECURE", label: "Secure (true/false)", placeholder: "false" },
    ],
    test: {
      requiresInput: true,
      inputName: "testEmail",
      inputLabel: "Địa chỉ email test (để trống = verify SMTP)",
      inputPlaceholder: "you@example.com",
      label: "Gửi mail test",
    },
  },
];

function CategoryPanel({ category }) {
  const [form] = Form.useForm();
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testInput, setTestInput] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/integrations/${category.key}`);
      const d = res.data.data || {};
      setData(d);
      const formValues = {};
      for (const f of category.fields) {
        formValues[f.name] = d[f.name]?.isSet
          ? (f.secret ? MASK : (d[f.name].value || ""))
          : "";
      }
      form.setFieldsValue(formValues);
    } catch (e) {
      message.error(e.response?.data?.message || "Không tải được cấu hình");
    } finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [category.key]);

  const onSave = async (values) => {
    setSaving(true);
    try {
      const res = await axios.put(`/integrations/${category.key}`, values);
      const updated = res.data?.updated || [];
      message.success(
        updated.length
          ? `Đã cập nhật ${updated.length} field: ${updated.join(", ")}`
          : "Không có thay đổi để lưu"
      );
      await load();
    } catch (e) {
      message.error(e.response?.data?.message || "Lưu thất bại");
    } finally { setSaving(false); }
  };

  const onTest = async () => {
    setTesting(true);
    try {
      const body = category.test.requiresInput
        ? { [category.test.inputName]: testInput }
        : {};
      const res = await axios.post(`/integrations/${category.key}/test`, body);
      const d = res.data?.data || {};
      const note = d.mock ? " (mock mode)" : "";
      message.success((d.message || "Kết nối thành công") + note);
    } catch (e) {
      message.error(e.response?.data?.message || "Test thất bại");
    } finally { setTesting(false); }
  };

  const configuredCount = category.fields.filter((f) => data[f.name]?.isSet).length;

  return (
    <div>
      <Alert
        type={configuredCount > 0 ? "success" : "info"}
        showIcon
        message={
          <Space>
            <span>{category.description}</span>
            {configuredCount > 0 && (
              <Tag color="green" icon={<CheckCircleOutlined />}>
                Đã cấu hình {configuredCount}/{category.fields.length}
              </Tag>
            )}
          </Space>
        }
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical" onFinish={onSave} disabled={loading}>
        {category.fields.map((f) => (
          <Form.Item
            key={f.name}
            name={f.name}
            label={
              <Space>
                <Text>{f.label}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>({f.name})</Text>
                {f.secret && (
                  <Tooltip title="Được mã hóa AES-256-GCM trong DB">
                    <EyeInvisibleOutlined style={{ color: "#94a3b8" }} />
                  </Tooltip>
                )}
                {data[f.name]?.isSet && <Tag color="green" style={{ marginLeft: 4 }}>Đã set</Tag>}
              </Space>
            }
          >
            <Input
              placeholder={f.placeholder || (f.secret ? "Để trống = giữ nguyên" : "")}
              autoComplete="off"
            />
          </Form.Item>
        ))}

        <Space>
          <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
            Lưu cấu hình
          </Button>
          <Button onClick={load} disabled={saving}>Tải lại</Button>
        </Space>
      </Form>

      <Divider />
      <Title level={5}>Kiểm tra kết nối</Title>
      <Space.Compact style={{ width: "100%", maxWidth: 600 }}>
        {category.test.requiresInput && (
          <Input
            placeholder={category.test.inputPlaceholder}
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            style={{ flex: 1 }}
          />
        )}
        <Button
          type="default"
          icon={<ThunderboltOutlined />}
          loading={testing}
          onClick={onTest}
          disabled={category.test.requiresInput && !testInput}
        >
          {category.test.label}
        </Button>
      </Space.Compact>
      {category.test.requiresInput && (
        <Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
          {category.test.inputLabel}
        </Paragraph>
      )}
    </div>
  );
}

export default function Integrations() {
  return (
    <PlanGate moduleKey="integrations" moduleName="Trung tâm Tích hợp">
    <Card
      title={<Space><ApiOutlined /><span>Tích hợp & API keys</span></Space>}
      bordered={false}
    >
      <Paragraph type="secondary">
        Cấu hình credentials cho các dịch vụ bên ngoài. <Text strong>Secrets được mã hóa AES-256-GCM</Text> trong DB.
        Giá trị trong UI ưu tiên hơn biến <Text code>.env</Text>. Bỏ trống một field = giữ nguyên giá trị cũ.
      </Paragraph>
      <Tabs
        items={[
          ...CATEGORIES.map((c) => ({
            key: c.key,
            label: <Space>{c.icon}{c.label}</Space>,
            children: <CategoryPanel category={c} />,
          })),
          {
            key: "WEBHOOKS",
            label: <Space><LinkOutlined />Webhooks</Space>,
            children: <WebhooksPanel />,
          },
          {
            key: "BANK_ACCOUNTS",
            label: <Space><BankOutlined />Tài khoản ngân hàng</Space>,
            children: <BankAccountsPanel />,
          },
        ]}
      />
    </Card>
    </PlanGate>
  );
}
