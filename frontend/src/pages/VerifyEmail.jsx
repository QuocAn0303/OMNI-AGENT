/**
 * Frontend: pages/VerifyEmail.jsx — Xác minh email
 * 
 * Tổng quan:
 * - Trang xác minh email qua token từ URL search param
 * - API: GET /auth/verify-email?token=...
 * - State: status (verifying/success/error), message
 * - Logic: Tự động gọi API khi mount, dùng useRef để tránh gọi 2 lần
 * 
 * Components/Hooks/Exports:
 * - VerifyEmail (default export): Hiển thị spinner hoặc kết quả xác minh
 */
import { useEffect, useState, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Spin, Button, Result } from 'antd'
import api from '../api/axios'

export default function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')
  const [status, setStatus] = useState(token ? 'verifying' : 'error')
  const [message, setMessage] = useState(token ? '' : 'Thiếu token xác minh')
  const calledRef = useRef(false)

  useEffect(() => {
    if (!token || calledRef.current) return
    calledRef.current = true
    api.get('/auth/verify-email', { params: { token } })
      .then(() => {
        setStatus('success')
        setMessage('Email đã được xác minh thành công!')
      })
      .catch((err) => {
        setStatus('error')
        setMessage(err.response?.data?.message || 'Xác minh email thất bại')
      })
  }, [token])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
      {status === 'verifying' ? (
        <Spin size="large" tip="Đang xác minh email..." />
      ) : (
        <Result
          status={status}
          title={status === 'success' ? 'Xác minh thành công' : 'Xác minh thất bại'}
          subTitle={message}
          extra={
            <Button type="primary" size="large" onClick={() => navigate('/login')}>
              Đi đến đăng nhập
            </Button>
          }
        />
      )}
    </div>
  )
}