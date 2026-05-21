import { Navigate } from "react-router-dom";
import useAuthStore from "../stores/authStore";
import { useEffect, useState } from "react";
import axiosInstance from "../api/axios";
import { Spin } from "antd";

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, user, setUser, logout } = useAuthStore();
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
    } else {
      setLoading(false);
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

  return children;
};

export default ProtectedRoute;