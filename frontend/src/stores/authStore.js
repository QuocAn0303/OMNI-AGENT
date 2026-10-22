/**
 * Frontend: src/stores/authStore.js — Zustand store quản lý xác thực
 *
 * Tổng quan:
 * - Quản lý trạng thái user, token, originalToken (support mode)
 * - M7+ (security): access token chỉ nằm trong MEMORY (Zustand state),
 *   KHÔNG lưu localStorage → XSS không thể trộm token.
 * - Persistence sau reload: refresh token trong httpOnly cookie → initAuth()
 *   gọi POST /auth/refresh để khôi phục phiên khi khởi động app.
 * - Hỗ trợ login thường, loginAsTenant (giả lập support), exitSupportMode
 * - Cung cấp các action: login, logout, setUser, setTheme, setToken, initAuth
 *
 * Hooks/Exports:
 * - useAuthStore: Zustand hook xuất dạng named + default
 */
import { create } from "zustand";
import api, { clearAuthHeaders } from "../api/axios";

const initialTheme = localStorage.getItem("theme") || "light";
const initialBeginnerMode = localStorage.getItem("beginnerMode") !== "false";
const initialBusinessTemplate = localStorage.getItem("businessTemplate") || null;
const initialAccountingMode = localStorage.getItem("accountingMode") || null;

// Danh sách template F&B — dùng để Sidebar/KDS biết khi nào hiện menu F&B
const FNB_TEMPLATES = ["cafe", "nha_hang", "do_an_nhanh", "bar_pub"];

// Dedupe initAuth (chống gọi 2 lần khi React StrictMode double-invoke effect)
let initPromise = null;

const useAuthStore = create((set, get) => ({
  user: null,
  token: null,
  originalToken: null,
  isAuthenticated: false,
  theme: initialTheme,
  beginnerMode: initialBeginnerMode,
  businessTemplate: initialBusinessTemplate,
  accountingMode: initialAccountingMode,

  // M7+: refresh token nằm trong httpOnly cookie (backend set), access token
  // chỉ trong memory — KHÔNG đụng localStorage
  login: (userData, token) => {
    set({ user: userData, token, isAuthenticated: true });
    // Load settings (businessTemplate) ngay sau login
    get().loadSettings();
  },

  loginAsTenant: (userData, supportToken, originalJwt) => {
    set({
      user: userData,
      token: supportToken,
      originalToken: originalJwt,
      isAuthenticated: true,
    });
    get().loadSettings();
  },

  exitSupportMode: () => {
    const { originalToken } = get();
    if (originalToken) {
      set({ token: originalToken, originalToken: null });
      // Reload → mọi token trong memory mất → initAuth() khôi phục phiên
      // super admin qua refresh cookie
      window.location.href = "/admin";
    }
  },

  logout: () => {
    // Xóa token cũ còn sót từ phiên bản trước (migration sạch sẽ)
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("originalToken");
    localStorage.removeItem("businessTemplate");
    localStorage.removeItem("accountingMode");
    // Xoá Authorization đã merge vào axios defaults (H2). Nếu bỏ qua, thu ngân A
    // logout rồi B đăng nhập trên cùng máy POS thì các request sau vẫn mang
    // session của A cho tới khi reload trang.
    clearAuthHeaders();
    set({
      user: null,
      token: null,
      originalToken: null,
      isAuthenticated: false,
      businessTemplate: null,
      accountingMode: null,
    });
  },

  setUser: (userData) => set({ user: userData }),

  setTheme: (theme) => {
    localStorage.setItem("theme", theme);
    set({ theme });
  },

  setToken: (token) => {
    set({ token, isAuthenticated: !!token });
  },

  // Khôi phục phiên khi app khởi động: refresh token trong httpOnly cookie
  // tự động gửi kèm → lấy access token mới. Không có cookie → 401 → logged out.
  initAuth: async () => {
    if (get().token) return true;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const res = await api.post("/auth/refresh", {}, { withCredentials: true });
        const data = res.data?.data;
        if (data?.token) {
          set({ user: data.user, token: data.token, isAuthenticated: true });
          get().loadSettings();
          return true;
        }
        return false;
      } catch {
        set({ isAuthenticated: false });
        return false;
      } finally {
        initPromise = null;
      }
    })();
    return initPromise;
  },

  setBeginnerMode: (enabled) => {
    localStorage.setItem("beginnerMode", enabled ? "true" : "false");
    set({ beginnerMode: enabled });
  },

  // Cập nhật businessTemplate (gọi sau khi chọn ở Onboarding hoặc sửa settings)
  setBusinessTemplate: (template) => {
    if (template) localStorage.setItem("businessTemplate", template);
    else localStorage.removeItem("businessTemplate");
    set({ businessTemplate: template });
  },

  // Cập nhật accountingMode (FULL_VAS | SIMPLIFIED_HKD) — ẩn/hiện kế toán double-entry
  setAccountingMode: (mode) => {
    if (mode) localStorage.setItem("accountingMode", mode);
    else localStorage.removeItem("accountingMode");
    set({ accountingMode: mode });
  },

  // Fetch /settings để lấy businessTemplate + accountingMode — gọi sau login và khi init app
  loadSettings: async () => {
    try {
      const res = await api.get("/settings");
      const template = res.data?.data?.businessTemplate || null;
      const mode = res.data?.data?.accountingMode || null;
      get().setBusinessTemplate(template);
      get().setAccountingMode(mode);
    } catch {
      // non-blocking: chưa đăng nhập hoặc lỗi mạng
    }
  },

  // Helper: kiểm tra tenant hiện tại có phải F&B không
  isFnB: () => FNB_TEMPLATES.includes(get().businessTemplate),
}));

export { useAuthStore };
export default useAuthStore;
