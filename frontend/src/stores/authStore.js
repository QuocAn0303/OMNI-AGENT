/**
 * Frontend: src/stores/authStore.js — Zustand store quản lý xác thực
 *
 * Tổng quan:
 * - Quản lý trạng thái user, token, refreshToken, originalToken (support mode)
 * - Đọc token từ localStorage khi khởi tạo
 * - Hỗ trợ login thường, loginAsTenant (giả lập support), exitSupportMode
 * - Cung cấp các action: login, logout, setUser, setTheme, setToken, setRefreshToken
 *
 * Hooks/Exports:
 * - useAuthStore: Zustand hook xuất dạng named + default
 */
import { create } from "zustand";

const initialToken = localStorage.getItem("token") || null;
const initialRefresh = localStorage.getItem("refreshToken") || null;
// Lấy thêm token gốc nếu đang trong phiên hỗ trợ
const originalToken = localStorage.getItem("originalToken") || null;
const initialTheme = localStorage.getItem("theme") || "light";

const useAuthStore = create((set, get) => ({
  // Trạng thái ban đầu
  user: null,
  token: initialToken,
  refreshToken: initialRefresh,
  originalToken: originalToken,
  isAuthenticated: !!initialToken,
  theme: initialTheme,

  // Đăng nhập: lưu token + refreshToken
  login: (userData, token, refreshToken) => {
    if (token) localStorage.setItem("token", token);
    if (refreshToken) localStorage.setItem("refreshToken", refreshToken);
    set({ user: userData, token, refreshToken, isAuthenticated: true });
  },

  // Đăng nhập bằng Token Hỗ Trợ (Giả lập)
  loginAsTenant: (userData, supportToken, originalJwt) => {
    // 1. Lưu token hỗ trợ làm token chính để các API khác gọi
    localStorage.setItem("token", supportToken);
    // 2. Cất token gốc (của Super Admin) đi để sau này thoát ra
    localStorage.setItem("originalToken", originalJwt);

    set({
      user: userData,
      token: supportToken,
      originalToken: originalJwt,
      isAuthenticated: true,
    });
  },

  // Thoát khỏi chế độ Hỗ trợ, trở lại làm Super Admin
  exitSupportMode: () => {
    const { originalToken } = get();
    if (originalToken) {
      // Phục hồi lại token gốc
      localStorage.setItem("token", originalToken);
      localStorage.removeItem("originalToken");

      // Bạn sẽ cần reload lại trang hoặc gọi lại hàm fetchUser để cập nhật lại thông tin user từ token gốc.
      set({ token: originalToken, originalToken: null });
      window.location.href = "/admin"; // Redirect thẳng về trang Super Admin
    }
  },

  // Đăng xuất (chỉ client-side cleanup)
  logout: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("originalToken");
    set({
      user: null,
      token: null,
      refreshToken: null,
      originalToken: null,
      isAuthenticated: false,
    });
  },

  // Cập nhật thông tin user
  setUser: (userData) => set({ user: userData }),

  setTheme: (theme) => {
    localStorage.setItem("theme", theme);
    set({ theme });
  },

  // Thiết lập token (hữu ích khi refresh)
  setToken: (token) => {
    if (token) localStorage.setItem("token", token);
    set({ token, isAuthenticated: !!token });
  },

  setRefreshToken: (refreshToken) => {
    if (refreshToken) localStorage.setItem("refreshToken", refreshToken);
    set({ refreshToken });
  },
}));

export { useAuthStore };
export default useAuthStore;
