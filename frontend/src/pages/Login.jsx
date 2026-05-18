import { useState } from "react";
import { Form, Input, Button, Alert } from "antd";
import { UserOutlined, LockOutlined, LoginOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import useAuthStore from "../stores/authStore";
import axiosInstance from "../api/axios";

/**
 * Login — Split layout: brand bên trái, form bên phải
 * Giữ nguyên logic auth cũ, chỉ thay UI.
 */
export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (values) => {
    setError("");
    setLoading(true);
    try {
      const resp = await axiosInstance.post("/auth/login", {
        email: values.username,
        password: values.password,
      });
      const data = resp.data?.data || {};
      const token = data.token;
      const refreshToken = data.refreshToken;
      const user = data.user || null;
      login(user, token, refreshToken);
      if (token)
        axiosInstance.defaults.headers.common.Authorization = `Bearer ${token}`;
      navigate("/dashboard");
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          "Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* LEFT: Brand panel */}
      <section className="login-brand" aria-hidden="true">
        <div className="login-brand__header">
          <div className="login-brand__logo">E</div>
          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: 16,
                letterSpacing: "-0.02em",
              }}
            >
              ERP System
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
              Retail Management
            </div>
          </div>
        </div>

        <div className="login-brand__body">
          <h1 className="login-brand__headline">
            Vận hành bán lẻ{" "}
            <span className="login-brand__headline-accent">thông minh.</span>
          </h1>
          <p className="login-brand__description">
            Quản lý sản phẩm, kho hàng, đơn hàng, nhân sự và báo cáo — tất cả
            trong một nền tảng duy nhất.
          </p>
        </div>

        <div className="login-brand__footer">
          © {new Date().getFullYear()} ERP System · v1.0
        </div>
      </section>

      {/* RIGHT: Form */}
      <section className="login-form-wrapper">
        <div className="login-card">
          <h2 className="login-card__title">Chào mừng trở lại</h2>
          <p className="login-card__subtitle">
            Đăng nhập để tiếp tục vào hệ thống
          </p>

          {error && (
            <Alert
              message={error}
              type="error"
              showIcon
              style={{ marginBottom: 20 }}
              closable
              onClose={() => setError("")}
            />
          )}

          <Form
            layout="vertical"
            onFinish={handleSubmit}
            size="large"
            requiredMark={false}
            autoComplete="off"
          >
            <Form.Item
              label="Tên đăng nhập"
              name="username"
              rules={[
                { required: true, message: "Vui lòng nhập tên đăng nhập" },
              ]}
            >
              <Input
                prefix={<UserOutlined style={{ color: "var(--text-muted)" }} />}
                placeholder="admin"
                autoFocus
              />
            </Form.Item>

            <Form.Item
              label="Mật khẩu"
              name="password"
              rules={[{ required: true, message: "Vui lòng nhập mật khẩu" }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: "var(--text-muted)" }} />}
                placeholder="••••••••"
              />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              icon={<LoginOutlined />}
              block
              style={{ height: 48, marginTop: 8, fontWeight: 500 }}
            >
              Đăng nhập
            </Button>
          </Form>

          <div
            style={{
              marginTop: 24,
              paddingTop: 16,
              borderTop: "1px solid var(--border-light)",
              fontSize: 12,
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            Cần hỗ trợ? Liên hệ quản trị viên hệ thống.
          </div>
        </div>
      </section>
    </div>
  );
}
