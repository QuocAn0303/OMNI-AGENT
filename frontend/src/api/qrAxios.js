/**
 * Frontend: src/api/qrAxios.js — Axios instance PUBLIC cho QR ordering (khách hàng)
 *
 * Khác với api/axios.js (dùng cho ERP nội bộ):
 * - KHÔNG có interceptor JWT (khách không đăng nhập)
 * - KHÔNG tự động refresh token / redirect /login khi 401
 * → An toàn cho trang /q/:qrToken hiển thị trên điện thoại khách hàng
 */
import axios from "axios";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000/api").replace(/\/$/, "");
const API_BASE_URL = import.meta.env.DEV ? "/api" : API_URL;

const qrAxios = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 15000,
});

export default qrAxios;
