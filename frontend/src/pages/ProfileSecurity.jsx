import { useState, useEffect } from "react";
import {
  Card, Form, Input, Button, Space, Alert, Typography, Divider, Tag, Row, Col, List,
} from "antd";
import {
  SafetyCertificateOutlined, KeyOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ReloadOutlined, CopyOutlined,
} from "@ant-design/icons";
import { QRCodeSVG } from "qrcode.react";
import PageHeader from "../components/layout/PageHeader";
import axios from "../api/axios";
import useAuthStore from "../stores/authStore";
import useToast from "../components/shared/useToast";
import useConfirm from "../components/shared/useConfirm";

const { Title, Text, Paragraph } = Typography;

export default function ProfileSecurity() {
  const toast = useToast();
  const confirm = useConfirm();
  const { user, setUser } = useAuthStore();

  const [step, setStep] = useState("idle"); // idle | setup | verify | done
  const [qrData, setQrData] = useState(null);
  const [secret, setSecret] = useState("");
  const [backupCodes, setBackupCodes] = useState([]);
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [loadingEnable, setLoadingEnable] = useState(false);
  const [loadingDisable, setLoadingDisable] = useState(false);
  const [verifyForm] = Form.useForm();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (user?.twoFactorEnabled) {
      setStep("done");
    }
  }, [user]);

  const handleSetup = async () => {
    setLoadingSetup(true);
    try {
      const res = await axios.post("/auth/2fa/setup");
      const data = res.data?.data || res.data;
      setQrData(data.otpauth);
      setSecret(data.secret);
      setStep("setup");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Không thể tạo mã 2FA");
    } finally {
      setLoadingSetup(false);
    }
  };

  const handleEnable = async (values) => {
    setLoadingEnable(true);
    try {
      const res = await axios.post("/auth/2fa/enable", { token: values.token });
      const data = res.data?.data || res.data;
      setBackupCodes(data.backupCodes || []);
      setStep("verify");
      setUser({ ...user, twoFactorEnabled: true });
      toast.success("Bật 2FA thành công");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Mã OTP không hợp lệ");
    } finally {
      setLoadingEnable(false);
    }
  };

  const handleDisable = () => {
    confirm.deleteConfirm({
      title: "Tắt xác thực 2FA?",
      content: "Tài khoản của bạn sẽ mất lớp bảo vệ bổ sung. Bạn có thể bật lại sau.",
      onOk: async () => {
        setLoadingDisable(true);
        try {
          await axios.post("/auth/2fa/disable");
          setStep("idle");
          setQrData(null);
          setSecret("");
          setBackupCodes([]);
          setUser({ ...user, twoFactorEnabled: false });
          toast.success("Đã tắt 2FA");
        } catch (err) {
          toast.error(err?.response?.data?.message || "Không thể tắt 2FA");
        } finally {
          setLoadingDisable(false);
        }
      },
    });
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Đã sao chép mã dự phòng");
    } catch {
      toast.error("Không thể sao chép");
    }
  };

  const headerActions = (
    <Button icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
      Làm mới
    </Button>
  );

  const renderIdle = () => (
    <div style={{ textAlign: "center", padding: "40px 0" }}>
      <SafetyCertificateOutlined style={{ fontSize: 64, color: "var(--color-primary)", marginBottom: 16 }} />
      <Title level={4}>Bảo vệ tài khoản bằng xác thực 2 lớp</Title>
      <Paragraph type="secondary" style={{ maxWidth: 500, margin: "0 auto 24px" }}>
        Sử dụng ứng dụng xác thực (Google Authenticator, Authy, ...) để tạo mã OTP
        mỗi khi đăng nhập, tăng cường bảo mật cho tài khoản.
      </Paragraph>
      <Button type="primary" size="large" loading={loadingSetup} onClick={handleSetup}>
        Thiết lập 2FA
      </Button>
    </div>
  );

  const renderSetup = () => (
    <Row gutter={[32, 32]}>
      <Col xs={24} md={10} style={{ textAlign: "center" }}>
        <div style={{
          background: "#fff", padding: 16, borderRadius: 8, display: "inline-block",
          border: "1px solid #e5e7eb",
        }}>
          {qrData && <QRCodeSVG value={qrData} size={200} />}
        </div>
        <div style={{ marginTop: 12 }}>
          <Text type="secondary">Hoặc nhập mã secret vào ứng dụng:</Text>
          <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 13, color: "#374151" }}>{secret}</div>
        </div>
      </Col>
      <Col xs={24} md={14}>
        <Alert
          type="info"
          showIcon
          message="Quét mã QR bằng ứng dụng Google Authenticator hoặc Authy"
          style={{ marginBottom: 16 }}
        />
        <Form form={verifyForm} layout="vertical" onFinish={handleEnable}>
          <Form.Item
            label="Nhập mã OTP từ ứng dụng"
            name="token"
            rules={[
              { required: true, message: "Vui lòng nhập mã OTP" },
              { len: 6, message: "Mã OTP gồm 6 chữ số" },
            ]}
          >
            <Input.OTP length={6} size="large" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loadingEnable}>
                Xác thực & Bật 2FA
              </Button>
              <Button onClick={() => { setStep("idle"); setQrData(null); setSecret(""); }}>
                Hủy
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Col>
    </Row>
  );

  const renderVerify = () => (
    <div>
      <Alert
        type="success"
        showIcon
        message="Xác thực 2 lớp đã được bật thành công!"
        style={{ marginBottom: 16 }}
      />
      <Card title="Mã dự phòng (Backup Codes)" size="small" style={{ marginBottom: 16 }}>
        <Paragraph type="secondary">
          Lưu những mã này ở nơi an toàn. Mỗi mã chỉ dùng được một lần khi bạn không có điện thoại.
        </Paragraph>
        <List
          size="small"
          dataSource={backupCodes}
          renderItem={(code) => (
            <List.Item style={{ fontFamily: "monospace", fontSize: 14 }}>
              <Text code>{code}</Text>
            </List.Item>
          )}
          style={{ maxWidth: 300 }}
        />
        <Button icon={<CopyOutlined />} onClick={copyCodes} style={{ marginTop: 12 }}>
          {copied ? "Đã sao chép" : "Sao chép tất cả"}
        </Button>
      </Card>
      <Button type="primary" onClick={() => { setStep("done"); }}>
        Hoàn tất
      </Button>
    </div>
  );

  const renderDone = () => (
    <div>
      <Alert
        type="success"
        showIcon
        icon={<CheckCircleOutlined />}
        message={<Text strong>Xác thực 2 lớp đang hoạt động</Text>}
        description="Mỗi lần đăng nhập, bạn sẽ cần nhập mã OTP từ ứng dụng xác thực."
        style={{ marginBottom: 16 }}
      />
      <Button danger loading={loadingDisable} onClick={handleDisable}>
        Tắt xác thực 2FA
      </Button>
    </div>
  );

  return (
    <div className="profile-security-page">
      <PageHeader
        title="Bảo mật tài khoản"
        subtitle="Quản lý xác thực 2 lớp (2FA)"
        actions={headerActions}
      />
      <Card bordered={false} className="shadow-sm mt-4" style={{ borderRadius: 8 }}>
        {step === "idle" && renderIdle()}
        {step === "setup" && renderSetup()}
        {step === "verify" && renderVerify()}
        {step === "done" && renderDone()}
      </Card>
    </div>
  );
}
