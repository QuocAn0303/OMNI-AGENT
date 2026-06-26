/**
 * Frontend: pages/Forbidden.jsx — 403 Forbidden
 * 
 * Tổng quan:
 * - Trang hiển thị lỗi 403 khi người dùng không có quyền truy cập
 * - Không gọi API, không state
 * - Logic: Nút "Về Dashboard" điều hướng về /
 * 
 * Components/Hooks/Exports:
 * - Forbidden (default export): Màn hình 403 với nút quay về
 */
import { Button, Result } from 'antd'
import { useNavigate } from 'react-router-dom'

export default function Forbidden() {
  const navigate = useNavigate()
  return (
    <Result
      status="403"
      title="403"
      subTitle="Bạn không có quyền truy cập trang này."
      extra={
        <Button type="primary" onClick={() => navigate('/dashboard')}>
          Về Dashboard
        </Button>
      }
    />
  )
}
