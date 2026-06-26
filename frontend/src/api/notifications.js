/**
 * Frontend: src/api/notifications.js — API module Thông báo
 *
 * Tổng quan:
 * - Lấy danh sách thông báo (có phân trang, params lọc)
 * - getUnreadCount: lấy số thông báo chưa đọc
 * - markNotificationRead: đánh dấu đã đọc một thông báo
 * - markAllNotificationsRead: đánh dấu đã đọc tất cả
 *
 * Exports:
 * - getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead
 */
import axios from "./axios";

const unwrap = (res) => res.data?.data ?? res.data;

export const getNotifications = (params) => axios.get("/notifications", { params }).then(unwrap);
export const getUnreadCount = () => axios.get("/notifications/unread-count").then(unwrap);
export const markNotificationRead = (id) => axios.patch(`/notifications/${id}/read`).then(unwrap);
export const markAllNotificationsRead = () => axios.patch("/notifications/read-all").then(unwrap);
