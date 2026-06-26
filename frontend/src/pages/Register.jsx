/**
 * Frontend: pages/Register.jsx — Đăng ký tài khoản doanh nghiệp
 * 
 * Tổng quan:
 * - Trang đăng ký với form nhập companyName, fullName, email, password, industry
 * - API: POST /auth/register
 * - State: loading, error, done (hiển thị success)
 * - Logic: Sau đăng ký thành công → hiển thị màn hình "Kiểm tra email"
 * 
 * Components/Hooks/Exports:
 * - Register (default export): Form đăng ký và màn hình xác nhận email
 */
import { useState } from 'react'
import { Form, Input, Button, Select, Alert, Typography } from 'antd'
import { ShopOutlined, MailOutlined, LockOutlined, BankOutlined, UserOutlined } from '@ant-design/icons'
import { useNavigate, Link } from 'react-router-dom'
import api from '../api/axios'

const { Title, Text } = Typography

const industries = [
  'retail', 'fnb', 'fashion', 'electronics', 'cosmetics',
  'pharmacy', 'grocery', 'service', 'other',
]

export default function Register() {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const onFinish = async (values) => {
    setError('')
    setLoading(true)
    try {
      await api.post('/auth/register', values)
      setDone(true)
    } catch (err) {
      setError(err.response?.data?.message || 'Đăng ký thất bại')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="login-page">
        <section className="login-brand" aria-hidden="true">
          <div className="login-brand__header">
            <div className="login-brand__logo">A</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: '-0.02em' }}>Aduu ERP</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Business Management Platform</div>
            </div>
          </div>
          <div className="login-brand__body">
            <h1 className="login-brand__headline">Hãy kiểm tra email của bạn</h1>
            <p className="login-brand__description">
              Chúng tôi đã gửi một email xác minh đến địa chỉ bạn đã đăng ký. Vui lòng kiểm tra hộp thư đến và nhấp vào liên kết xác minh.
            </p>
          </div>
          <div className="login-brand__footer">
            &copy; {new Date().getFullYear()} Aduu ERP &middot; v2.0
          </div>
        </section>
        <section className="login-form-wrapper">
          <div className="login-card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>📧</div>
            <Title level={3}>Kiểm tra email</Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
              Email xác minh đã được gửi. Vui lòng nhấp vào liên kết trong email để kích hoạt tài khoản.
            </Text>
            <Button type="primary" onClick={() => navigate('/login')} block size="large">
              Đi đến đăng nhập
            </Button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="login-page">
      <section className="login-brand" aria-hidden="true">
        <div className="login-brand__header">
          <div className="login-brand__logo">A</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: '-0.02em' }}>Aduu ERP</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Business Management Platform</div>
          </div>
        </div>
        <div className="login-brand__body">
          <h1 className="login-brand__headline">
            Bắt đầu miễn phí,{' '}
            <span className="login-brand__headline-accent">nâng cấp khi cần.</span>
          </h1>
          <p className="login-brand__description">
            Tạo tài khoản doanh nghiệp và trải nghiệm nền tảng quản lý bán lẻ toàn diện.
          </p>
        </div>
        <div className="login-brand__footer">
          &copy; {new Date().getFullYear()} Aduu ERP &middot; v2.0
        </div>
      </section>

      <section className="login-form-wrapper">
        <div className="login-card">
          <h2 className="login-card__title">Đăng ký miễn phí</h2>
          <p className="login-card__subtitle">Tạo tài khoản doanh nghiệp mới</p>

          {error && (
            <Alert message={error} type="error" showIcon style={{ marginBottom: 20 }} closable onClose={() => setError('')} />
          )}

          <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
            <Form.Item name="companyName" rules={[{ required: true, message: 'Nhập tên công ty' }, { min: 2, message: 'Tối thiểu 2 ký tự' }]}>
              <Input prefix={<ShopOutlined style={{ color: 'var(--text-muted)' }} />} placeholder="Tên công ty / cửa hàng" />
            </Form.Item>

            <Form.Item name="fullName" rules={[{ required: true, message: 'Nhập họ tên' }, { min: 2 }]}>
              <Input prefix={<UserOutlined style={{ color: 'var(--text-muted)' }} />} placeholder="Họ và tên" />
            </Form.Item>

            <Form.Item name="email" rules={[{ required: true, message: 'Nhập email' }, { type: 'email', message: 'Email không hợp lệ' }]}>
              <Input prefix={<MailOutlined style={{ color: 'var(--text-muted)' }} />} placeholder="Email" />
            </Form.Item>

            <Form.Item name="password" rules={[{ required: true, message: 'Nhập mật khẩu' }, { min: 6, message: 'Tối thiểu 6 ký tự' }]}>
              <Input.Password prefix={<LockOutlined style={{ color: 'var(--text-muted)' }} />} placeholder="Mật khẩu" />
            </Form.Item>

            <Form.Item name="industry">
              <Select placeholder="Ngành nghề (tùy chọn)" allowClear suffixIcon={<BankOutlined />}>
                {industries.map((ind) => (
                  <Select.Option key={ind} value={ind}>{ind}</Select.Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block style={{ height: 48, fontWeight: 500 }}>
                Đăng ký miễn phí
              </Button>
            </Form.Item>
          </Form>

          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-light)', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
            Đã có tài khoản?{' '}
            <Link to="/login" style={{ color: 'var(--color-primary)', fontWeight: 500 }}>Đăng nhập</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
