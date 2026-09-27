/**
 * Frontend: components/layout/TopBar.jsx — Thanh điều hướng trên cùng
 *
 * Tổng quan:
 * - Hiển thị breadcrumb động dựa trên location.pathname
 * - Badge thông báo realtime qua Socket.IO (polling 30s + socket push)
 * - Nút chuyển theme (sáng/tối), chọn ngôn ngữ (vi/en), thông báo
 * - Hiển thị thông tin gói dịch vụ (plan) và avatar người dùng
 * - Hỗ trợ chế độ impersonate (SUPER_OMEGA_ULTRA_ADMIN) với Alert cảnh báo
 *   và nút "Thoát & Thu hồi" (gọi API admin/support-session/:id/revoke)
 *
 * Props:
 *   onMenuClick: function — Callback mở sidebar trên mobile
 *
 * Exports:
 *   TopBar: Component chính
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { Dropdown, Avatar, Badge, message, Alert, Button, Tag } from "antd";
import {
  BellOutlined,
  SettingOutlined,
  LogoutOutlined,
  UserOutlined,
  SearchOutlined,
  MenuOutlined,
  SunOutlined,
  MoonOutlined,
  GlobalOutlined,
  QuestionCircleOutlined,
  CrownOutlined,
} from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { io } from "socket.io-client";
import useAuthStore from "../../stores/authStore";
import usePlan from "../../hooks/usePlan";
import { getUnreadCount } from "../../api/notifications";
import api from "../../api/axios";
import GlobalSearch from "../shared/GlobalSearch";

function getSocketOrigin() {
  if (import.meta.env.DEV) return window.location.origin;
  const apiBase = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
  return apiBase.replace(/\/api\/?$/, "");
}

const ROUTE_LABELS = {
  "/dashboard": "Dashboard",
  "/analytics": "Analytics",
  "/pos": "POS — Bán hàng",
  "/orders": "Đơn hàng",
  "/products": "Sản phẩm",
  "/products/create": "Sản phẩm / Thêm mới",
  "/inventory": "Kho hàng",
  "/customers": "Khách hàng",
  "/hr": "Nhân sự & Lương",
  "/users": "Quản lý tài khoản",
  "/reports": "Báo cáo",
  "/audit": "Audit Log",
  "/purchase-orders": "Mua hàng",
  "/debts": "Công nợ",
  "/profile": "Hồ sơ cá nhân",
  "/settings": "Cài đặt",
};

export default function TopBar({ onMenuClick }) {
  const location = useLocation();
  const navigate = useNavigate();
  // Đã thêm originalToken và exitSupportMode từ authStore
  const {
    user,
    logout,
    token,
    originalToken,
    exitSupportMode,
    theme,
    setTheme,
  } = useAuthStore();
  const { plan, loading: planLoading } = usePlan();
  const { t, i18n } = useTranslation();
  const [unread, setUnread] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const langMenu = {
    items: [
      { key: "vi", label: "Tiếng Việt" },
      { key: "en", label: "English" },
    ],
    onClick: ({ key }) => {
      i18n.changeLanguage(key);
      localStorage.setItem("i18n_lang", key);
    },
  };

  const refreshUnread = useCallback(() => {
    getUnreadCount()
      .then((r) => setUnread(Number(r?.count ?? 0)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshUnread();
    const interval = setInterval(refreshUnread, 30000);
    return () => clearInterval(interval);
  }, [refreshUnread]);

  useEffect(() => {
    if (!token) return undefined;
    const socket = io(getSocketOrigin(), {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 2000,
    });
    socket.on("notification", refreshUnread);
    return () => {
      socket.off("notification", refreshUnread);
      socket.disconnect();
    };
  }, [token, refreshUnread]);

  const currentLabel = useMemo(() => {
    if (ROUTE_LABELS[location.pathname]) return ROUTE_LABELS[location.pathname];
    const match = Object.keys(ROUTE_LABELS)
      .filter((k) => location.pathname.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    return match ? ROUTE_LABELS[match] : "Trang";
  }, [location.pathname]);

  const restartTours = () => {
    ["dashboard", "pos", "products", "orders", "inventory"].forEach((key) => {
      localStorage.removeItem(`tour_${key}_done`);
    });
    message.success(t("topbar.tourRestarted"));
  };

  // --- LOGIC HỖ TRỢ BẮT ĐẦU ---

  // Xử lý khi bấm nút "Đăng xuất"
  const handleLogoutClick = () => {
    if (originalToken) {
      // Nếu đang trong chế độ hỗ trợ, chặn đăng xuất và hiển thị thông báo
      message.error(
        "Bạn đang trong phiên hỗ trợ. Vui lòng bấm 'Thoát & Thu hồi' để trở về trước khi đăng xuất.",
        5,
      );
      return;
    }
    logout();
  };

  // Xử lý khi bấm nút "Thoát & Thu hồi"
  const handleRevokeSession = async () => {
    try {
      const sessionId = user?.supportSessionId;
      if (sessionId) {
        // Gọi API thu hồi phiên trên server
        await api.post(`/admin/support-session/${sessionId}/revoke`);
        message.success("Đã thu hồi phiên hỗ trợ thành công.");
      }
    } catch (err) {
      console.error("Lỗi thu hồi phiên:", err);
      message.warning(
        "Không thể thu hồi phiên trên server, nhưng vẫn sẽ thoát chế độ hỗ trợ trên máy bạn.",
      );
    } finally {
      // Gọi hàm thoát chế độ hỗ trợ của Zustand
      exitSupportMode();
    }
  };

  // --- LOGIC HỖ TRỢ KẾT THÚC ---

  const userMenu = {
    items: [
      {
        key: "profile",
        icon: <UserOutlined />,
        label: t("topbar.profile"),
        onClick: () => navigate("/profile"),
      },
      {
        key: "settings",
        icon: <SettingOutlined />,
        label: t("topbar.settings"),
        onClick: () => navigate("/settings"),
      },
      {
        key: "tour",
        icon: <QuestionCircleOutlined />,
        label: t("topbar.restartTour"),
        onClick: restartTours,
      },
      { type: "divider" },
      {
        key: "logout",
        icon: <LogoutOutlined />,
        label: t("topbar.logout"),
        danger: true,
        onClick: handleLogoutClick, // Sử dụng hàm đã bọc kiểm tra
      },
    ],
  };

  return (
    <>
      {/* THANH CẢNH BÁO CHẾ ĐỘ HỖ TRỢ */}
      {originalToken && (
        <Alert
          message="CHẾ ĐỘ HỖ TRỢ (GIẢ LẬP)"
          description="Mọi thao tác của bạn đang được ghi nhận vào hệ thống của khách hàng. Hãy cẩn thận!"
          type="warning"
          showIcon
          action={
            <Button
              size="small"
              type="primary"
              danger
              onClick={handleRevokeSession}
            >
              Thoát & Thu hồi
            </Button>
          }
          style={{
            borderRadius: 0,
            textAlign: "center",
            borderBottom: "2px solid #faad14",
            fontWeight: "bold",
          }}
        />
      )}

      <header className="topbar">
        <div className="topbar__left">
          <button
            type="button"
            className="topbar__icon-btn topbar__hamburger"
            aria-label="Mở menu"
            onClick={onMenuClick}
          >
            <MenuOutlined style={{ fontSize: 16 }} />
          </button>
          <div className="topbar__breadcrumb">
            <span className="topbar__breadcrumb-current">{currentLabel}</span>
          </div>
        </div>

        <div className="topbar__right">
          {!planLoading && plan?.name && (
            <Tag icon={<CrownOutlined />} color="gold" style={{ marginRight: 8, cursor: "pointer" }} onClick={() => navigate("/subscription")}>
              {plan.name}
            </Tag>
          )}

          <button
            type="button"
            className="topbar__icon-btn"
            aria-label="Tìm kiếm"
            title="Tìm kiếm (Ctrl + K)"
            onClick={() => setSearchOpen(true)}
          >
            <SearchOutlined style={{ fontSize: 16 }} />
          </button>

          <button
            type="button"
            className="topbar__icon-btn"
            aria-label="Chuyển giao diện"
            title={theme === "dark" ? "Chuyển sang sáng" : "Chuyển sang tối"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? (
              <SunOutlined style={{ fontSize: 16 }} />
            ) : (
              <MoonOutlined style={{ fontSize: 16 }} />
            )}
          </button>

          <Dropdown menu={langMenu} placement="bottomRight" trigger={["click"]}>
            <button
              type="button"
              className="topbar__icon-btn"
              aria-label="Ngôn ngữ"
              title="Ngôn ngữ"
            >
              <GlobalOutlined style={{ fontSize: 16 }} />
            </button>
          </Dropdown>

          <button
            type="button"
            className="topbar__icon-btn"
            aria-label="Thông báo"
            title="Thông báo"
            onClick={() => navigate("/notifications")}
          >
            <Badge count={unread} size="small" offset={[-2, 2]}>
              <BellOutlined style={{ fontSize: 16 }} />
            </Badge>
          </button>

          <Dropdown menu={userMenu} placement="bottomRight" trigger={["click"]}>
            <button
              type="button"
              className="topbar__icon-btn"
              style={{
                width: "auto",
                padding: "0 8px",
                gap: 8,
                display: "flex",
                alignItems: "center",
              }}
              aria-label="Tài khoản"
            >
              <Avatar
                size={28}
                style={{
                  background: "var(--primary)",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {(user?.fullName || user?.username || "U")[0].toUpperCase()}
              </Avatar>
            </button>
          </Dropdown>
        </div>
      </header>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
