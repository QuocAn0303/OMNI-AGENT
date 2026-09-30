import { Empty, Button } from 'antd';
import { useTranslation } from 'react-i18next';

/**
 * EmptyState — trạng thái rỗng dùng chung
 *
 * Hỗ trợ 2 cách truyền nút hành động:
 * - `action`: ReactNode (khớp children của antd <Empty>) — dùng khi cần icon/custom
 * - `actionText` + `onAction`: dạng rút gọn
 */
const EmptyState = ({ title, description, action, actionText, onAction, icon }) => {
  const { t } = useTranslation();
  return (
    <Empty
      image={icon || Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <div>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>{title || t('common.noData')}</div>
          {description && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{description}</div>}
        </div>
      }
      style={{ padding: '40px 0' }}
    >
      {action}
      {!action && actionText && onAction && (
        <Button type="primary" onClick={onAction}>{actionText}</Button>
      )}
    </Empty>
  );
};

export default EmptyState;
