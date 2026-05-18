import { create } from "zustand";

const initialToken = localStorage.getItem("token") || null;
const initialRefresh = localStorage.getItem("refreshToken") || null;

const useAuthStore = create((set) => ({
  // Trạng thái ban đầu
  user: null,
  token: initialToken,
  refreshToken: initialRefresh,
  isAuthenticated: !!initialToken,

  // Đăng nhập: lưu token + refreshToken
  login: (userData, token, refreshToken) => {
    if (token) localStorage.setItem("token", token);
    if (refreshToken) localStorage.setItem("refreshToken", refreshToken);
    set({ user: userData, token, refreshToken, isAuthenticated: true });
  },

  // Đăng xuất (chỉ client-side cleanup)
  logout: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    set({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  },

  // Cập nhật thông tin user
  setUser: (userData) => set({ user: userData }),

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
