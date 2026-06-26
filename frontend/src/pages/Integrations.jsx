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
  Card, Tabs, Form, Input, Button, Space, Tag, Alert, message, Typography, Divider, Tooltip,
} from "antd";
import {
  ApiOutlined, CloudUploadOutlined, MessageOutlined, MailOutlined,
  CheckCircleOutlined, EyeInvisibleOutlined, ThunderboltOutlined, SaveOutlined,
} from "@ant-design/icons";
import PlanGate from '../components/PlanGate';
import axios from "../api/axios";

const { Title, Text, Paragraph } = Typography;
const MASK = "••••••••";

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

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [category.key]);

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
        items={CATEGORIES.map((c) => ({
          key: c.key,
          label: <Space>{c.icon}{c.label}</Space>,
          children: <CategoryPanel category={c} />,
        }))}
      />
    </Card>
    </PlanGate>
  );
}
