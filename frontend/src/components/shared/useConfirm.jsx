import { Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

const useConfirm = () => {
  const { t } = useTranslation();
  const deleteConfirm = ({ title, content, onOk }) => {
    Modal.confirm({
      title: title || t('common.confirmDelete'),
      icon: <ExclamationCircleOutlined />,
      content: content || t('common.confirmDeleteContent'),
      okText: t('common.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk,
    });
  };
  const dangerConfirm = ({ title, content, onOk }) => {
    Modal.confirm({
      title,
      icon: <ExclamationCircleOutlined />,
      content,
      okText: t('common.confirm'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk,
    });
  };
  return { deleteConfirm, dangerConfirm };
};

export default useConfirm;
