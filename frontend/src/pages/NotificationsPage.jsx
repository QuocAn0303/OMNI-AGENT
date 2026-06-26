/**
 * Frontend: pages/NotificationsPage.jsx — Thông báo
 * 
 * Tổng quan:
 * - Trang danh sách thông báo với bộ lọc "chỉ chưa đọc", đánh dấu đã đọc
 * - API: getNotifications, markNotificationRead, markAllNotificationsRead
 * - State: data, filters (page, unreadOnly)
 * - Logic: List thông báo với tag "Mới", action đánh dấu đã đọc từng cái hoặc tất cả
 * 
 * Components/Hooks/Exports:
 * - NotificationsPage (default export): Danh sách thông báo + button đọc tất cả
 */
import { useEffect, useState, useCallback } from "react";
import { List, Button, Tag, message, Card } from "antd";
import PageHeader from "../components/layout/PageHeader";
import { getNotifications, markNotificationRead, markAllNotificationsRead } from "../api/notifications";

export default function NotificationsPage() {
  const [data, setData] = useState({ notifications: [], pagination: { total: 0 } });
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ page: 1, limit: 30, unreadOnly: false });

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
