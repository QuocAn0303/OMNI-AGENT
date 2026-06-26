/**
 * Frontend: src/components/UpgradePrompt.jsx — UpgradePrompt
 * 
 * Tổng quan:
 * - Hiển thị thông báo gợi ý nâng cấp gói dịch vụ khi user chưa đủ quyền truy cập module/tính năng.
 * - Chứa nút "Xem các gói" dẫn đến trang /subscription.
 * 
 * Props:
 * - moduleName: string (default: "tính năng này") — tên module/tính năng cần nâng cấp
 * 
 * Hàm/Exports:
 * - UpgradePrompt: Component thông báo nâng cấp gói
 */
import { Alert, Button } from 'antd'
import { CrownOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

export default function UpgradePrompt({ moduleName = 'tính năng này' }) {
  const navigate = useNavigate()

  return (
    <Alert
      type="warning"
      showIcon
      icon={<CrownOutlined />}
      message="Nâng cấp gói để sử dụng"
      description={`Gói hiện tại của bạn không hỗ trợ ${moduleName}. Vui lòng nâng cấp để mở khóa tính năng.`}
      action={
        <Button type="primary" ghost onClick={() => navigate('/subscription')}>
          Xem các gói
        </Button>
      }
      style={{ margin: 24 }}
    />
  )
}