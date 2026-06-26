/**
 * Component: shared/EmptyState — Placeholder hiển thị khi không có dữ liệu
 *
 * Tổng quan:
 * - Component dùng chung cho toàn bộ trang, hiển thị trạng thái rỗng
 * - Props: icon (ReactNode, mặc định InboxOutlined), title (string),
 *          description (string), action (ReactNode)
 * - Khi danh sách/table không có bản ghi, EmptyState được dùng làm fallback UI
 *
 * Exports:
 * - EmptyState: React functional component (default export)
 */
import { InboxOutlined } from '@ant-design/icons';

/**
 * EmptyState — placeholder khi không có dữ liệu
 *
 * Props:
 *   icon:        ReactNode (default: InboxOutlined)
 *   title:       string
 *   description: string
 *   action:      ReactNode (button, link...)
 */
export default function EmptyState({
  icon,
  title = 'Chưa có dữ liệu',
  description = 'Dữ liệu sẽ xuất hiện ở đây khi bạn thêm mới.',
  action,
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        {icon || <InboxOutlined />}
      </div>
      <div className="empty-state__title">{title}</div>
      <div className="empty-state__description">{description}</div>
      {action && <div>{action}</div>}
    </div>
  );
}
