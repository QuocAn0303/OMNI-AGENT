import { useState, useEffect } from 'react'
import { Table, Card, Row, Col, Tag, Button, Switch, Select, message, Statistic, Typography } from 'antd'
import { ShopOutlined, UserOutlined, TeamOutlined, CrownOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import api from '../../api/axios'

const { Title } = Typography

export default function SuperAdminDashboard() {
  const { t } = useTranslation()
  const [tenants, setTenants] = useState([])
  const [stats, setStats] = useState({ total: 0, active: 0, free: 0, pro: 0, enterprise: 0 })
  const [loading, setLoading] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [tenantsRes, statsRes] = await Promise.all([
        api.get('/admin/tenants'),
        api.get('/admin/stats'),
      ])
      setTenants(tenantsRes.data.data)
      setStats(statsRes.data.data)
    } catch (err) {
      message.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const handleToggleActive = async (id, isActive) => {
    try {
      await api.put(`/admin/tenants/${id}`, { isActive: !isActive })
      message.success(isActive ? 'Tenant deactivated' : 'Tenant activated')
      fetchData()
    } catch (err) {
      message.error('Update failed')
    }
  }

  const handleChangePlan = async (id, plan) => {
    try {
      await api.put(`/admin/tenants/${id}`, { plan })
      message.success('Plan updated')
      fetchData()
    } catch (err) {
      message.error('Update failed')
    }
  }

  const planColors = { free: 'default', pro: 'blue', enterprise: 'purple' }

  const columns = [
    { title: t('admin.name', 'Tên'), dataIndex: 'name', key: 'name' },
    { title: 'Slug', dataIndex: 'slug', key: 'slug', responsive: ['md'] },
    {
      title: t('admin.plan', 'Gói'),
      dataIndex: 'plan',
      key: 'plan',
      render: (plan, record) => (
        <Select value={plan} size="small" style={{ width: 120 }} onChange={(v) => handleChangePlan(record.id, v)}>
          <Select.Option value="free">FREE</Select.Option>
          <Select.Option value="pro">PRO</Select.Option>
          <Select.Option value="enterprise">ENTERPRISE</Select.Option>
        </Select>
      ),
    },
    {
      title: t('admin.users', 'Users'),
      dataIndex: '_count',
      key: 'users',
      render: (c) => c?.users || 0,
    },
    {
      title: t('admin.status', 'Trạng thái'),
      dataIndex: 'isActive',
      key: 'isActive',
      render: (active, record) => (
        <Switch checked={active} onChange={() => handleToggleActive(record.id, active)} size="small" />
      ),
    },
    {
      title: t('admin.created', 'Ngày tạo'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      responsive: ['lg'],
      render: (d) => new Date(d).toLocaleDateString('vi-VN'),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}><CrownOutlined /> {t('admin.title', 'Super Admin Dashboard')}</Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6}>
          <Card><Statistic title={t('admin.totalTenants', 'Tổng tenant')} value={stats.total} prefix={<ShopOutlined />} /></Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card><Statistic title={t('admin.activeTenants', 'Đang hoạt động')} value={stats.active} prefix={<TeamOutlined />} valueStyle={{ color: '#059669' }} /></Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card><Statistic title="PRO" value={stats.pro} prefix={<UserOutlined />} valueStyle={{ color: '#2563eb' }} /></Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card><Statistic title="ENTERPRISE" value={stats.enterprise} prefix={<CrownOutlined />} valueStyle={{ color: '#7c3aed' }} /></Card>
        </Col>
      </Row>

      <Card>
        <Table
          dataSource={tenants}
          columns={columns}
          rowKey="id"
          loading={loading}
          scroll={{ x: 700 }}
          pagination={{ pageSize: 20 }}
        />
      </Card>
    </div>
  )
}
