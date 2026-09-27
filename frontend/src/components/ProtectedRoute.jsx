/**
 * Frontend: src/components/ProtectedRoute.jsx — ProtectedRoute
 * 
 * Tổng quan:
 * - Bảo vệ route yêu cầu xác thực. Nếu chưa đăng nhập → redirect /login.
 * - Tự động gọi GET /auth/me để lấy thông tin user nếu store có token nhưng chưa có user.
 * - Hiển thị Spin loading trong khi đang xác thực.
 * 
 * Props:
 * - children: ReactNode — component con được render nếu đã xác thực
 * 
 * Hàm/Exports:
 * - ProtectedRoute: Component kiểm tra isAuthenticated và fetch user
 */
import { Navigate, useLocation } from "react-router-dom";
import useAuthStore from "../stores/authStore";
import { useEffect, useState } from "react";
import axiosInstance from "../api/axios";
import { Spin } from "antd";

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, user, setUser, logout } = useAuthStore();
  const location = useLocation();
  const [loading, setLoading] = useState(!user && isAuthenticated);

  useEffect(() => {
    if (isAuthenticated && !user) {
      axiosInstance
        .get("/auth/me")
        .then((res) => {
          setUser(res.data.data);
          setLoading(false);
        })
        .catch((err) => {
          console.error("Lỗi khi lấy thông tin user:", err);
          logout();
          setLoading(false);
        });
    }
  }, [isAuthenticated, user, setUser, logout]);

  // Nếu chưa đăng nhập, redirect về trang login
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  // L3: tài khoản mặc định (seed) phải đổi mật khẩu trước khi dùng hệ thống
  // — chỉ cho vào /profile (nơi có form đổi mật khẩu), mọi trang khác redirect
  if (user?.mustChangePassword && location.pathname !== "/profile") {
    return <Navigate to="/profile" replace />;
  }

  return children;
};

export default ProtectedRoute;