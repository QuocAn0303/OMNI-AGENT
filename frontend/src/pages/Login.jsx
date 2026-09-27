/**
 * Frontend: pages/Login.jsx — Đăng nhập
 * 
 * Tổng quan:
 * - Trang đăng nhập với split layout (brand bên trái, form bên phải)
 * - API: POST /auth/login
 * - State: loading, error message
 * - Logic: Gọi login() từ authStore, lưu token vào axios header, điều hướng theo role
 * 
 * Components/Hooks/Exports:
 * - Login (default export): Form đăng nhập, xử lý auth, điều hướng dashboard/admin
 */
import { useState } from "react";
import { Form, Input, Button, Alert } from "antd";
import { UserOutlined, LockOutlined, LoginOutlined } from "@ant-design/icons";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from 'react-i18next';
import useAuthStore from "../stores/authStore";
import axiosInstance from "../api/axios";

/**
 * Login — Split layout: brand bên trái, form bên phải
 * Giữ nguyên logic auth cũ, chỉ thay UI.
 */
export default function Login() {
  const { t } = useTranslation();
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
      const user = data.user || null;
      // M7: refresh token được set vào httpOnly cookie bởi backend — không cần xử lý ở đây
      login(user, token);
      if (token)
        axiosInstance.defaults.headers.common.Authorization = `Bearer ${token}`;
      if (user?.role === "SUPER_OMEGA_ULTRA_ADMIN") {
        navigate("/admin");
      } else {
        navigate("/dashboard");
      }
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          t('login.errorFallback'),
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
          <div className="login-brand__logo">A</div>
          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: 16,
                letterSpacing: "-0.02em",
              }}
            >
              Aduu ERP
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
              {t('login.brandSubtitle')}
            </div>
          </div>
        </div>

        <div className="login-brand__body">
          <h1 className="login-brand__headline">
            {t('login.brandHeadlinePre')}<span className="login-brand__headline-accent">{t('login.brandHeadlineAccent')}</span>
          </h1>
          <p className="login-brand__description">
            {t('login.brandDescription')}
          </p>
        </div>

        <div className="login-brand__footer">
          © {new Date().getFullYear()} Aduu ERP · v2.0
        </div>
      </section>

      {/* RIGHT: Form */}
      <section className="login-form-wrapper">
        <div className="login-card">
          <h2 className="login-card__title">{t('login.welcome')}</h2>
          <p className="login-card__subtitle">
            {t('login.subtitle')}
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
              label={t('login.username')}
              name="username"
              rules={[
                { required: true, message: t('login.usernameRequired') },
              ]}
            >
              <Input
                prefix={<UserOutlined style={{ color: "var(--text-muted)" }} />}
                placeholder={t('login.usernamePlaceholder')}
                autoFocus
              />
            </Form.Item>

            <Form.Item
              label={t('auth.password')}
              name="password"
              rules={[{ required: true, message: t('login.passwordRequired') }]}
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
              {t('auth.loginButton')}
            </Button>
          </Form>

          <div
            style={{
              marginTop: 24,
              paddingTop: 16,
              borderTop: "1px solid var(--border-light)",
              fontSize: 13,
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            {t('login.noAccount')}{" "}
            <Link to="/register" style={{ color: "var(--color-primary)", fontWeight: 500 }}>
              {t('login.registerFree')}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
