import { Empty, Button } from 'antd';
import { useTranslation } from 'react-i18next';

const EmptyState = ({ title, description, actionText, onAction, icon }) => {
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
      {actionText && onAction && <Button type="primary" onClick={onAction}>{actionText}</Button>}
    </Empty>
  );
};

export default EmptyState;
