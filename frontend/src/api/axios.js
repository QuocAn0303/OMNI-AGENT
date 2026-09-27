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
axiosInstance.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) config.headers.Authorization = `Bearer ${token}`;
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
          // M7+: lưu token mới vào store (in-memory) — không đụng localStorage
          useAuthStore.getState().setToken(newToken);
          axiosInstance.defaults.headers.common.Authorization =
            "Bearer " + newToken;
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
      Sentry.captureException(err, {
        tags: { api_url: originalRequest?.url, http_status: status },
      });
    }

    return Promise.reject(err);
  },
);

export default axiosInstance;
