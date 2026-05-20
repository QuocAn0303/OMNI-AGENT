import { useState } from 'react'
import { Form, Input, Button, Select, message, Typography } from 'antd'
import { ShopOutlined, MailOutlined, LockOutlined, BankOutlined } from '@ant-design/icons'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../api/axios'
import useAuthStore from '../stores/authStore'

const { Title, Text } = Typography

const industries = [
  'retail', 'fnb', 'fashion', 'electronics', 'cosmetics',
  'pharmacy', 'grocery', 'service', 'other',
]

export default function Register() {
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { t } = useTranslation()
  const setAuth = useAuthStore((s) => s.setAuth)

  const onFinish = async (values) => {
    setLoading(true)
    try {
      const res = await api.post('/auth/register', values)
      const { token, user } = res.data.data
      setAuth(token, user)
      message.success(t('register.success', 'Đăng ký thành công!'))
      navigate('/onboarding')
    } catch (err) {
      message.error(err.response?.data?.message || t('register.error', 'Đăng ký thất bại'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-body, #f8fafc)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={2} style={{ marginBottom: 4 }}>{t('register.title', 'Đăng ký doanh nghiệp')}</Title>
          <Text type="secondary">{t('register.subtitle', 'Bắt đầu miễn phí, nâng cấp khi cần')}</Text>
        </div>

        <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
          <Form.Item name="companyName" rules={[{ required: true, message: t('register.companyRequired', 'Nhập tên công ty') }, { min: 2, message: t('register.companyMin', 'Tối thiểu 2 ký tự') }]}>
            <Input prefix={<ShopOutlined />} placeholder={t('register.companyPlaceholder', 'Tên công ty / cửa hàng')} />
          </Form.Item>

          <Form.Item name="email" rules={[{ required: true, message: t('register.emailRequired', 'Nhập email') }, { type: 'email', message: t('register.emailInvalid', 'Email không hợp lệ') }]}>
            <Input prefix={<MailOutlined />} placeholder="Email" />
          </Form.Item>

          <Form.Item name="password" rules={[{ required: true, message: t('register.passwordRequired', 'Nhập mật khẩu') }, { min: 6, message: t('register.passwordMin', 'Tối thiểu 6 ký tự') }]}>
            <Input.Password prefix={<LockOutlined />} placeholder={t('register.passwordPlaceholder', 'Mật khẩu')} />
          </Form.Item>

          <Form.Item name="industry">
            <Select placeholder={t('register.industryPlaceholder', 'Ngành nghề (tùy chọn)')} allowClear suffixIcon={<BankOutlined />}>
              {industries.map((ind) => (
                <Select.Option key={ind} value={ind}>
                  {t(`register.industries.${ind}`, ind)}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              {t('register.submit', 'Đăng ký')}
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center' }}>
          <Text type="secondary">
            {t('register.hasAccount', 'Đã có tài khoản?')}{' '}
            <Link to="/login">{t('register.login', 'Đăng nhập')}</Link>
          </Text>
        </div>
      </div>
    </div>
  )
}
