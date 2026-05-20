import axios from "axios";
import * as Sentry from "@sentry/react";
//chỉnh ở đây để set lại port api nếu cần
// Nếu không set `VITE_API_URL` khi chạy local, mặc định dùng dev backend
const API_BASE = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "http://localhost:4000/api" : "")
).replace(/\/$/, "");

// Khởi tạo instance của axios (dùng cho hầu hết request)
const axiosInstance = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

// Request Interceptor: thêm Bearer token vào mỗi request nếu có
axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
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
        originalRequest.url.includes("/auth/refresh")
      ) {
        localStorage.removeItem("token");
        localStorage.removeItem("refreshToken");
        window.location.href = "/login";
        return Promise.reject(err);
      }

      originalRequest._retry = true;
      const refreshToken = localStorage.getItem("refreshToken");
      if (!refreshToken) {
        localStorage.removeItem("token");
        window.location.href = "/login";
        return Promise.reject(err);
      }

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
        const response = await axios.post(`${API_BASE}/auth/refresh`, {
          refreshToken,
        });
        const newToken = response.data?.data?.token;
        const newRefresh = response.data?.data?.refreshToken;
        if (newToken) {
          localStorage.setItem("token", newToken);
          if (newRefresh) localStorage.setItem("refreshToken", newRefresh);
          axiosInstance.defaults.headers.common.Authorization =
            "Bearer " + newToken;
          processQueue(null, newToken);
          originalRequest.headers.Authorization = "Bearer " + newToken;
          return axiosInstance(originalRequest);
        }
        throw new Error("Không nhận được token khi refresh");
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        localStorage.removeItem("token");
        localStorage.removeItem("refreshToken");
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
