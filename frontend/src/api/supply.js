/**
 * api/supply.js — KPI chuỗi cung ứng
 */
import axios from './axios';

const unwrap = (r) => r.data?.data ?? r.data;

export const getSupplyKpis = (days = 30) =>
  axios.get('/supply/kpis', { params: { days } }).then(unwrap);