/**
 * Frontend: src/api/lots.js — API module Quản lý Lô (Lot Tracking)
 *
 * Tổng quan:
 * - Theo dõi lô hàng trong sản xuất: lấy danh sách, chi tiết lô
 * - getExpiringLots: lấy các lô sắp hết hạn (mặc định 30 ngày)
 * - receiveLot: nhập lô mới, consumeLot: xuất lô tiêu thụ
 *
 * Exports:
 * - getLots, getExpiringLots, getLot, receiveLot, consumeLot
 */
// frontend/src/api/lots.js
import axios from "./axios";
const unwrap = (res) => res.data?.data ?? res.data;

export const getLots         = (params)     => axios.get("/production/lots", { params }).then(unwrap);
export const getExpiringLots = (days = 30)  => axios.get("/production/lots/expiring", { params: { days } }).then(unwrap);
export const getLot          = (id)         => axios.get(`/production/lots/${id}`).then(unwrap);
export const receiveLot      = (data)       => axios.post("/production/lots/receive", data).then(unwrap);
export const consumeLot      = (id, qty, extra) => axios.post(`/production/lots/${id}/consume`, { quantity: qty, ...extra }).then(unwrap);
