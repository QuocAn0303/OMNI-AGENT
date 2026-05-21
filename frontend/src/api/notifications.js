import axios from "./axios";

const unwrap = (res) => res.data?.data ?? res.data;

export const getNotifications = (params) => axios.get("/notifications", { params }).then(unwrap);
export const getUnreadCount = () => axios.get("/notifications/unread-count").then(unwrap);
export const markNotificationRead = (id) => axios.patch(`/notifications/${id}/read`).then(unwrap);
export const markAllNotificationsRead = () => axios.patch("/notifications/read-all").then(unwrap);
