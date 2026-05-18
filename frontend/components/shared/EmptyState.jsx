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
