/**
 * Frontend: components/shared/ErrorState.jsx — Trạng thái lỗi
 *
 * Tổng quan:
 * - Hiển thị thông báo lỗi dùng Ant Design Result (status="error")
 * - Nếu có onRetry → hiển thị nút "Thử lại" với icon ReloadOutlined
 *
 * Props:
 *   message: string — Nội dung lỗi (default 'Có lỗi xảy ra')
 *   onRetry: function — Callback thử lại (nếu không có → ẩn nút)
 *
 * Exports:
 *   ErrorState: Component chính
 */
import { Button, Result } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'

export default function ErrorState({ message = 'Có lỗi xảy ra', onRetry }) {
  return (
    <Result
      status="error"
      title={message}
      extra={
        onRetry && (
          <Button icon={<ReloadOutlined />} onClick={onRetry}>
            Thử lại
          </Button>
        )
      }
    />
  )
}
