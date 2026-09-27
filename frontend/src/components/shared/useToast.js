import { message } from 'antd';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const useToast = () => {
  const { t } = useTranslation();
  const success = useCallback((msg) => message.success(msg || t('common.success')), [t]);
  const error = useCallback((msg) => message.error(msg || t('common.error')), [t]);
  const info = useCallback((msg) => message.info(msg), []);
  const warning = useCallback((msg) => message.warning(msg), []);
  return { success, error, info, warning };
};

export default useToast;
