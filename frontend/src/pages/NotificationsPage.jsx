/**
 * Frontend: pages/NotificationsPage.jsx — Thông báo
 * 
 * Tổng quan:
 * - Trang danh sách thông báo với bộ lọc "chỉ chưa đọc", đánh dấu đã đọc
 * - Bật/tắt Web Push (PWA): đăng ký subscription + gửi thử notification
 * - API: getNotifications, markNotificationRead, markAllNotificationsRead
 */
import { useEffect, useState, useCallback } from "react";
import { List, Button, Tag, message, Card, Space, Switch, Alert, Tooltip } from "antd";
import { NotificationOutlined } from "@ant-design/icons";
import PageHeader from "../components/layout/PageHeader";
import { getNotifications, markNotificationRead, markAllNotificationsRead } from "../api/notifications";
import { subscribeToPush, unsubscribeFromPush, isPushSupported, isSubscribed } from "../utils/pushSubscribe";
import api from "../api/axios";

export default function NotificationsPage() {
  const [data, setData] = useState({ notifications: [], pagination: { total: 0 } });
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ page: 1, limit: 30, unreadOnly: false });
  const [pushOn, setPushOn] = useState(isSubscribed());
  const [pushBusy, setPushBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getNotifications(filters));
    } catch (e) {
      message.error(e.response?.data?.message || "Lỗi");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const supported = isPushSupported();

  const togglePush = async (enabled) => {
    if (!supported) {
      message.warning("Trình duyệt không hỗ trợ thông báo đẩy (cần HTTPS + Service Worker)");
      return;
    }
    setPushBusy(true);
    try {
      if (enabled) {
        if (Notification.permission === "denied") {
          message.error("Bạn đã chặn thông báo — hãy mở lại trong cài đặt trình duyệt");
          return;
        }
        if (Notification.permission === "default") {
          const perm = await Notification.requestPermission();
          if (perm !== "granted") {
            message.info("Không nhận được quyền thông báo");
            return;
          }
        }
        const res = await subscribeToPush();
        if (res.ok) {
          setPushOn(true);
          message.success("Đã bật thông báo — thử nghiệm ngay bên dưới");
        } else if (res.reason === "no-config") {
          message.error("Hệ thống chưa sẵn sàng nhận thông báo — thử lại sau giây lát");
        } else {
          message.error("Không đăng ký được thông báo");
        }
      } else {
        await unsubscribeFromPush();
        setPushOn(false);
        message.success("Đã tắt thông báo đẩy");
      }
    } finally {
      setPushBusy(false);
    }
  };

  const sendTest = async () => {
    setPushBusy(true);
    try {
      const res = await api.post("/push/test");
      if (res.data?.data?.sent > 0) message.success("Đã gửi — kiểm tra điện thoại/máy tính");
      else message.info("Thiết bị này chưa đăng ký nhận thông báo");
    } catch (e) {
      message.error(e.response?.data?.message || "Gửi thử thất bại");
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Thông báo"
        extra={
          <Button onClick={async () => { await markAllNotificationsRead(); message.success("Đã đọc tất cả"); load(); }}>
            Đọc tất cả
          </Button>
        }
      />
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <Space size={8}>
            <NotificationOutlined style={{ fontSize: 20, color: "var(--color-primary, #0d9488)" }} />
            <div>
              <b>Thông báo đẩy (PWA)</b>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Nhận cảnh báo tồn kho, đơn hàng, nhắc việc ngay cả khi đóng ứng dụng
              </div>
            </div>
          </Space>
          <Space>
            <Tooltip title={supported ? "" : "Cần trình duyệt hỗ trợ (Chrome/Edge/Firefox) chạy qua HTTPS hoặc localhost"}>
              <Switch
                checked={pushOn}
                loading={pushBusy}
                disabled={!supported}
                onChange={togglePush}
                checkedChildren="Đang bật"
                unCheckedChildren="Tắt"
              />
            </Tooltip>
            <Button disabled={!pushOn} loading={pushBusy} onClick={sendTest}>
              Gửi thử
            </Button>
          </Space>
        </div>
        {!supported && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            message="Trình duyệt không hỗ trợ Web Push"
            description="Sử dụng Chrome/Edge/Firefox mới nhất, truy cập qua HTTPS (hoặc localhost khi phát triển)."
          />
        )}
      </Card>
      <Card>
        <div style={{ marginBottom: 12 }}>
          <Button type={filters.unreadOnly ? "primary" : "default"} onClick={() => setFilters({ ...filters, unreadOnly: !filters.unreadOnly, page: 1 })}>
            Chỉ chưa đọc
          </Button>
        </div>
        <List
          loading={loading}
          dataSource={data.notifications}
          renderItem={(item) => (
            <List.Item
              actions={[
                !item.isRead && (
                  <Button
                    key="read"
                    size="small"
                    type="link"
                    onClick={async () => {
                      await markNotificationRead(item.id);
                      load();
                    }}
                  >
                    Đánh dấu đọc
                  </Button>
                ),
              ]}
            >
              <List.Item.Meta
                title={
                  <span>
                    {!item.isRead && <Tag color="blue">Mới</Tag>} {item.title}
                  </span>
                }
                description={item.message}
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
}
