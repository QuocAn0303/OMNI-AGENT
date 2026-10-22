/**
 * Frontend: src/api/axios.js — Axios instance + JWT interceptors
 *
 * Tổng quan:
 - Tạo axios instance với baseURL tự động (DEV → /api proxy, PROD → env hoặc localhost:4000)
 * - Request interceptor: tự động gắn Bearer token từ localStorage
 * - Response interceptor: tự động refresh token khi gặp 401, queue các request đang chờ
 * - Gửi lỗi 500+ lên Sentry để tracking
 * - Nếu refresh thất bại → xoá token + redirect /login
 *
 * Exports:
 * - axiosInstance (default): Axios instance đã cấu hình
 */
import axios from "axios";
import * as Sentry from "@sentry/react";
import useAuthStore from "../stores/authStore";
// Dev: luôn gọi `/api` cùng origin với Vite rồi proxy sang backend (xem vite.config.js).
// Khi đó không bị "lệch cổng" chỉ vì file .env cập nhật sau khi Vite đã start.
const API_BASE = import.meta.env.VITE_API_URL;
if (!API_BASE && import.meta.env.PROD) {
  throw new Error("VITE_API_URL must be set in production");
}
const API_URL = (API_BASE || "http://localhost:4000/api").replace(/\/$/, "");
const API_BASE_URL = import.meta.env.DEV ? "/api" : API_URL;

// Khởi tạo instance của axios (dùng cho hầu hết request)
const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
  // M7: refresh token nằm trong httpOnly cookie → cần gửi kèm cookie mọi request
  withCredentials: true,
});

// Request Interceptor: thêm Bearer token vào mỗi request nếu có
// M7+ (security): token đọc từ Zustand store (in-memory) — KHÔNG đọc localStorage
//
// Security (H2): khi store đã logout (token = null) phải XOÁ header chứ không chỉ
// bỏ qua. Axios merge `defaults.headers.common` vào `config.headers` TRƯỚC khi
// interceptor chạy, nên chỉ `if (token)` là token cũ vẫn được gửi đi. Trên máy POS
// dùng chung, thu ngân A logout rồi B đăng nhập → mọi request vẫn mang session của A.
axiosInstance.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    } else if (config.headers) {
      delete config.headers.Authorization;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Refresh token logic: queue các request khi đang refresh
let isRefreshing = false;
let failedQueue = [];
const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

axiosInstance.interceptors.response.use(
  (res) => res,
  async (err) => {
    const originalRequest = err.config;
    if (!originalRequest) return Promise.reject(err);

    const status = err.response?.status;

    if (status === 401 && !originalRequest._retry) {
      // Nếu request là refresh thì không cố refresh nữa
      if (
        originalRequest.url &&
        (originalRequest.url.includes("/auth/refresh") ||
          originalRequest.url.includes("/auth/login"))
      ) {
        return Promise.reject(err);
      }

      originalRequest._retry = true;

      if (isRefreshing) {
        return new Promise(function (resolve, reject) {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = "Bearer " + token;
            return axiosInstance(originalRequest);
          })
          .catch((e) => Promise.reject(e));
      }

      isRefreshing = true;
      try {
        // M7: refresh token nằm trong httpOnly cookie — gửi tự động, KHÔNG đọc từ localStorage
        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true });
        const newToken = response.data?.data?.token;
        if (newToken) {
          // M7+: lưu token mới vào store (in-memory) — không đụng localStorage.
          // KHÔNG ghi vào axiosInstance.defaults: interceptor đã gắn header cho mọi
          // request, ghi thêm vào đây chỉ tạo một bản sao token tồn đọng qua các lần
          // logout (H2). `originalRequest.headers` là duy nhất cần set lại.
          useAuthStore.getState().setToken(newToken);
          processQueue(null, newToken);
          originalRequest.headers.Authorization = "Bearer " + newToken;
          return axiosInstance(originalRequest);
        }
        throw new Error("Không nhận được token khi refresh");
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        useAuthStore.getState().logout();
        window.location.href = "/login";
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    if (!status || status >= 500) {
      // H1 (security): KHÔNG truyền `err` vào Sentry. `err` là AxiosError, các
      // property enumerable của nó (config, request, response) chứa
      // `config.headers.Authorization` (JWT đang hiệu lực) và `config.data`
      // (toàn bộ payload: CCCD, số điện thoại, lương, số tài khoản NH). SDK Sentry
      // copy chúng vào event.extra và không tự lọc Authorization. Một lỗi 500 bất
      // kỳ ở bất kỳ endpoint nào cũng đủ để gửi token + PII lên SaaS bên thứ ba —
      // vô hiệu hoá đúng biện pháp "token chỉ nằm trong memory" của dự án.
      // Chỉ log chuỗi đã lọc, không log object có thể chứa bí mật.
      Sentry.captureMessage(
        `API ${status ?? "network-error"} ${originalRequest?.method ?? "?"} ${originalRequest?.url ?? "?"}`,
        "error",
      );
    }

    return Promise.reject(err);
  },
);

/**
 * Xoá mọi dấu vết credential trên axios instance.
 * Gọi từ `authStore.logout()` để token của user vừa đăng xuất không còn sót ở
 * `defaults.headers` (H2) — kể cả khi một component còn mount gọi request.
 */
export function clearAuthHeaders() {
  delete axiosInstance.defaults.headers.common.Authorization;
}

export default axiosInstance;
