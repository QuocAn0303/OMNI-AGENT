import { useEffect, useState } from "react";
import { Alert, Button, Space, Progress } from "antd";
import { CrownOutlined, ClockCircleOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import axios from "../api/axios";

export default function TrialBanner() {
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get("/subscriptions/my");
        const sub = res.data?.data || res.data;
        if (!cancelled && sub) {
          const now = new Date();
          if (sub.endDate) {
            const endDate = new Date(sub.endDate);
            const daysLeft = Math.max(0, Math.ceil((endDate - now) / (1000 * 3600 * 24)));
            if (daysLeft > 0) {
              const totalDays = sub.startDate
                ? Math.max(1, Math.ceil((endDate - new Date(sub.startDate)) / (1000 * 3600 * 24)))
                : 30;
              const percentUsed = Math.round(((totalDays - daysLeft) / totalDays) * 100);
              setInfo({ daysLeft, totalDays, percentUsed, endDate, status: sub.status });
            }
          }
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || !info) return null;
  if (info.daysLeft <= 0) return null;

  // Chỉ cảnh báo khi còn <= 7 ngày (TRIAL hoặc ACTIVE sắp hết hạn)
  if (info.status === "ACTIVE" && info.daysLeft > 7) return null;
  // Gói FREE/trial còn nhiều hơn 7 ngày: im lặng
  if (info.status === "TRIAL" && info.daysLeft > 14) return null;

  const isUrgent = info.daysLeft <= 3;
  const urgency = isUrgent ? "error" : "warning";
  const isTrial = info.status === "TRIAL";
  const message = isUrgent
    ? `Chỉ còn ${info.daysLeft} ngày ${isTrial ? "dùng thử" : "sử dụng gói"} — gia hạn ngay để không bị gián đoạn!`
    : `Còn ${info.daysLeft} ngày ${isTrial ? "dùng thử" : "trước khi hết hạn gói"}`;

  return (
    <Alert
      type={urgency}
      icon={<CrownOutlined />}
      showIcon
      message={message}
      description={
        <Space style={{ marginTop: 8 }}>
          <Progress
            percent={Math.min(info.percentUsed, 100)}
            size="small"
            style={{ width: 120, marginBottom: 0 }}
            strokeColor={urgency === "error" ? "#dc2626" : "#d97706"}
          />
          <Button size="small" type={isUrgent ? "primary" : "default"} onClick={() => navigate("/subscription")}>
            {isUrgent ? "Gia hạn ngay" : "Xem gói dịch vụ"}
          </Button>
        </Space>
      }
      style={{ marginBottom: 16 }}
      closable
    />
  );
}
