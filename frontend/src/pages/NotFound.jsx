import { Result, Button } from "antd";
import { useNavigate } from "react-router-dom";
import useAuthStore from "../stores/authStore";

export default function NotFound() {
  const navigate = useNavigate();
  const isAuth = useAuthStore((s) => s.isAuthenticated);

  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
      <Result
        status="404"
        title="Trang không tồn tại"
        subTitle="Trang bạn đang tìm không có hoặc đã bị di chuyển."
        extra={
          <Button type="primary" onClick={() => navigate(isAuth ? "/dashboard" : "/")}>
            {isAuth ? "Về trang chủ" : "Về trang giới thiệu"}
          </Button>
        }
      />
    </div>
  );
}
