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
