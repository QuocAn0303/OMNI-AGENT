/**
 * api/replenishmentRules.js — Quy tắc nhập hàng (Odoo Reordering Rules)
 *
 * Cấu hình theo (sản phẩm × kho). `null` = chưa cấu hình ⇒ động cơ dùng mặc định.
 */
import axios from './axios';

const unwrap = (r) => r.data?.data ?? r.data;

export const getReplenishmentRules = (params) =>
  axios.get('/inventory/rules', { params }).then(unwrap);

export const updateReplenishmentRule = (payload) =>
  axios.put('/inventory/rules', payload).then(unwrap);