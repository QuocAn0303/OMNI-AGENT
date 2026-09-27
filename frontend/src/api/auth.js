/**
 * Frontend: src/api/auth.js — API module Auth
 *
 * Tổng quan:
 * - getSessions: Lấy danh sách phiên đăng nhập
 * - revokeSession: Thu hồi một phiên
 * - revokeAllSessions: Thu hồi tất cả phiên
 *
 * Exports:
 * - getSessions, revokeSession, revokeAllSessions
 */
import api from "./axios";

export const getSessions = () => api.get("/auth/sessions").then((r) => r.data.data);
export const revokeSession = (id) => api.delete(`/auth/sessions/${id}`).then((r) => r.data);
export const revokeAllSessions = () => api.delete("/auth/sessions").then((r) => r.data);
