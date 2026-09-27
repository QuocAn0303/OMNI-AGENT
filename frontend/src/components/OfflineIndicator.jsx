import { useEffect, useState } from 'react';
import { Alert, Badge, Space } from 'antd';
import { WifiOutlined, CloudSyncOutlined } from '@ant-design/icons';
import { isOnline, onStatusChange, getPendingCount } from '../utils/offlineQueue';

export default function OfflineIndicator() {
  const [online, setOnline] = useState(isOnline());
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPendingCount = async () => {
    try {
      setPendingCount(await getPendingCount());
    } catch {
      setPendingCount(0);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const unsub = onStatusChange((status) => {
      if (cancelled) return;
      setOnline(status);
      if (status) refreshPendingCount();
    });

    // Defer initial state sync to avoid setState-in-effect warning
    const initTimer = setTimeout(() => {
      if (cancelled) return;
      setOnline(isOnline());
      refreshPendingCount();
    }, 0);

    const pollInterval = setInterval(() => {
      if (!cancelled) refreshPendingCount();
    }, 10000);

    return () => {
      cancelled = true;
      unsub();
      clearTimeout(initTimer);
      clearInterval(pollInterval);
    };
  }, []);

  if (online && pendingCount === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      {!online && (
        <Alert
          type="warning"
          showIcon
          icon={<WifiOutlined />}
          message="Đang ngoại tuyến"
          description={`Bạn vẫn có thể bán hàng. ${pendingCount > 0 ? `${pendingCount} đơn đang chờ đồng bộ.` : 'Đơn hàng sẽ tự đồng bộ khi có mạng.'}`}
          banner
        />
      )}
      {online && pendingCount > 0 && (
        <Alert
          type="info"
          showIcon
          icon={<CloudSyncOutlined />}
          message={`Đang có ${pendingCount} đơn hàng chưa đồng bộ`}
          description="Chúng sẽ tự động được đồng bộ trong giây lát."
          banner
        />
      )}
    </div>
  );
}
