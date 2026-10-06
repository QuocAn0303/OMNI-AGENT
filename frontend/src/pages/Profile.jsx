/**
 * Frontend: pages/Profile.jsx — Thông tin cá nhân & bảo mật
 * 
 * Tổng quan:
 * - Trang quản lý thông tin cá nhân với 2 tab: thông tin tài khoản và bảo mật
 * - API: PUT /users/:id (cập nhật thông tin), PUT /auth/change-password
 * - State: loadingInfo, loadingPassword
 * - Logic: Đổ dữ liệu user từ authStore vào form, cập nhật fullName, đổi mật khẩu
 * 
 * Components/Hooks/Exports:
 * - Profile (default export): Form thông tin + đổi mật khẩu
 */
import React, { useState, useEffect } from "react";
import {
  Card,
  Tabs,
  Form,
  Input,
  Button,
  Avatar,
  message,
  Row,
  Col,
  Typography,
  Space,
  Divider,
  Alert,
} from "antd";
import {
  MailOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  IdcardOutlined,
  BankOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

// Import đúng đường dẫn tương đối từ src/pages/
import PageHeader from "../components/layout/PageHeader";
import axiosInstance from "../api/axios";
import useAuthStore from "../stores/authStore";

const { Title, Text } = Typography;

export default function Profile() {
  const { user, setUser } = useAuthStore();

  const [infoForm] = Form.useForm();
  const [passwordForm] = Form.useForm();

  const [loadingInfo, setLoadingInfo] = useState(false);
  const [loadingPassword, setLoadingPassword] = useState(false);

  // Đổ dữ liệu vào form Thông tin
  // Dựa theo schema.prisma, model User không có username, dùng email làm định danh gốc
  useEffect(() => {
    if (user) {
      infoForm.setFieldsValue({
        email: user.email,
        role: user.role,
        fullName: user.fullName,
        tenant: user.tenant?.name || "Chưa trực thuộc chi nhánh",
      });
    }
  }, [user, infoForm]);

  // Thuật toán Avatar tái sử dụng chính xác từ TopBar.jsx
  const avatarChar = (user?.fullName || user?.email || "U")[0].toUpperCase();

  // --- XỬ LÝ TAB 1: CẬP NHẬT THÔNG TIN ---
  const handleUpdateInfo = async (values) => {
    setLoadingInfo(true);
    try {
      // Gọi API cập nhật (axios đã tự động gắn /api qua baseURL)
      const response = await axiosInstance.put(`/users/${user?.id}`, {
        fullName: values.fullName,
      });

      const updatedData = response.data?.data || response.data;
      setUser({ ...user, ...updatedData });

      message.success("Cập nhật thông tin cá nhân thành công!");
    } catch (error) {
      const errorMsg =
        error.response?.data?.message ||
        "Có lỗi xảy ra khi cập nhật thông tin.";
      message.error(errorMsg);
    } finally {
      setLoadingInfo(false);
    }
  };

  // --- XỬ LÝ TAB 2: ĐỔI MẬT KHẨU ---
  const handleChangePassword = async (values) => {
    setLoadingPassword(true);
    try {
      await axiosInstance.put("/auth/change-password", {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });

      message.success(
        "Đổi mật khẩu thành công! Hệ thống đang chuyển hướng tới trang đăng nhập...",
        3,
      );
      passwordForm.resetFields();
      if (user?.mustChangePassword) {
        setUser({ ...user, mustChangePassword: false });
      }
      setTimeout(() => {
        useAuthStore.getState().logout();
        window.location.href = "/login";
      }, 1500);
    } catch (error) {
      const respData = error.response?.data;
      if (respData?.errors && Array.isArray(respData.errors) && respData.errors.length > 0) {
        const errorDetails = respData.errors.map((e) => e.message).join(", ");
        message.error(`Dữ liệu không hợp lệ: ${errorDetails}`);

        const fieldErrors = respData.errors.map((e) => ({
          name: e.field,
          errors: [e.message],
        }));
        passwordForm.setFields(fieldErrors);
      } else {
        const errorMsg =
          respData?.message ||
          "Mật khẩu hiện tại không đúng hoặc có lỗi xảy ra.";
        message.error(errorMsg);
      }
    } finally {
      setLoadingPassword(false);
    }
  };

  // Action phụ cho Header: Nút đồng bộ lại dữ liệu
  const headerActions = (
    <Button icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
      Làm mới dữ liệu
    </Button>
  );

  const items = [
    {
      key: "1",
      label: (
        <span>
          <IdcardOutlined />
          Thông tin tài khoản
        </span>
      ),
      children: (
        <Row gutter={[32, 32]} className="mt-4">
          <Col xs={24} md={8} className="text-center">
            <Space
              direction="vertical"
              size="large"
              align="center"
              style={{ width: "100%", padding: "20px 0" }}
            >
              <Avatar
                size={120}
                style={{
                  background: "var(--primary)", // Sử dụng CSS variable giống hệt TopBar
                  fontSize: "48px",
                  fontWeight: 600,
                }}
              >
                {avatarChar}
              </Avatar>
              <div>
                <Title level={4} style={{ margin: 0 }}>
                  {user?.fullName}
                </Title>
                <Text type="secondary">{user?.email}</Text>
              </div>
            </Space>
          </Col>

          <Col xs={24} md={16}>
            <Form
              form={infoForm}
              layout="vertical"
              onFinish={handleUpdateInfo}
              requiredMark="optional"
            >
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item label="Trực thuộc (Tenant)" name="tenant">
                    <Input disabled prefix={<BankOutlined />} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item label="Phân quyền (Role)" name="role">
                    <Input disabled prefix={<SafetyCertificateOutlined />} />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item label="Địa chỉ Email" name="email">
                <Input disabled prefix={<MailOutlined />} />
              </Form.Item>

              <Form.Item
                label="Họ và tên"
                name="fullName"
                rules={[
                  { required: true, message: "Vui lòng nhập họ và tên!" },
                ]}
              >
                <Input placeholder="Nhập họ và tên đầy đủ" />
              </Form.Item>

              <Divider />

              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loadingInfo}>
                  Lưu thay đổi
                </Button>
              </Form.Item>
            </Form>
          </Col>
        </Row>
      ),
    },
    {
      key: "2",
      label: (
        <span>
          <LockOutlined />
          Bảo mật
        </span>
      ),
      children: (
        <div style={{ maxWidth: "600px", padding: "16px 0" }}>
          {user?.mustChangePassword && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="Bạn đang dùng mật khẩu mặc định (123456)"
              description="Vì lý do bảo mật, bạn phải đổi mật khẩu trước khi sử dụng các tính năng khác của hệ thống. Mật khẩu mới cần tối thiểu 8 ký tự, có ít nhất 1 chữ hoa (A-Z) và 1 chữ số (0-9)."
            />
          )}
          <Form
            form={passwordForm}
            layout="vertical"
            onFinish={handleChangePassword}
            requiredMark="optional"
          >
            <Form.Item
              label="Mật khẩu hiện tại"
              name="currentPassword"
              rules={[
                { required: true, message: "Vui lòng nhập mật khẩu hiện tại!" },
              ]}
            >
              <Input.Password placeholder="Nhập mật khẩu đang sử dụng (mặc định: 123456)" />
            </Form.Item>

            <Form.Item
              label="Mật khẩu mới"
              name="newPassword"
              extra="Mật khẩu tối thiểu 8 ký tự, bao gồm ít nhất 1 chữ hoa (A-Z) và 1 chữ số (0-9)."
              rules={[
                { required: true, message: "Vui lòng nhập mật khẩu mới!" },
                { min: 8, message: "Mật khẩu phải có ít nhất 8 ký tự!" },
                {
                  pattern: /[A-Z]/,
                  message: "Mật khẩu phải có ít nhất 1 chữ hoa (A-Z)!",
                },
                {
                  pattern: /[0-9]/,
                  message: "Mật khẩu phải có ít nhất 1 chữ số (0-9)!",
                },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (value && value === getFieldValue("currentPassword")) {
                      return Promise.reject(
                        new Error("Mật khẩu mới phải khác mật khẩu hiện tại!"),
                      );
                    }
                    return Promise.resolve();
                  },
                }),
              ]}
              hasFeedback
            >
              <Input.Password placeholder="Nhập mật khẩu mới (VD: Candory@2026)" />
            </Form.Item>

            <Form.Item
              label="Xác nhận mật khẩu mới"
              name="confirmPassword"
              dependencies={["newPassword"]}
              hasFeedback
              rules={[
                { required: true, message: "Vui lòng xác nhận mật khẩu mới!" },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue("newPassword") === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(
                      new Error("Mật khẩu xác nhận không trùng khớp!"),
                    );
                  },
                }),
              ]}
            >
              <Input.Password placeholder="Nhập lại mật khẩu mới" />
            </Form.Item>

            <Form.Item style={{ marginTop: "32px" }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loadingPassword}
                danger
              >
                Cập nhật mật khẩu
              </Button>
            </Form.Item>
          </Form>
        </div>
      ),
    },
  ];

  return (
    <div className="profile-page">
      <PageHeader
        title="Thông tin cá nhân"
        subtitle="Quản lý tài khoản, phân quyền và thiết lập bảo mật"
        actions={headerActions}
      />

      <Card
        bordered={false}
        className="shadow-sm mt-4"
        style={{ borderRadius: "8px" }}
      >
        <Tabs defaultActiveKey={user?.mustChangePassword ? "2" : "1"} items={items} />
      </Card>
    </div>
  );
}
