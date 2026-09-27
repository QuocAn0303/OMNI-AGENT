/**
 * Frontend: src/api/warehouses.js — API module kho hàng
 *
 * Tổng quan:
 * - GET /warehouses trả về MẢNG kho (không phân trang) — dùng cho dropdown chọn kho
 *   ở GRN, kiểm kê, chuyển kho.
 *
 * Exports:
 * - getWarehouses(): danh sách kho đang hoạt động của tenant hiện tại
 */
import axios from "./axios";
import { unwrap } from "./accounting";

export const getWarehouses = () => axios.get("/warehouses").then(unwrap);
