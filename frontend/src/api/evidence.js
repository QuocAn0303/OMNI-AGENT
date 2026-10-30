/**
 * api/evidence.js — Bằng chứng thực nghiệm (chỉ đọc)
 *
 *  - getBacktestEvidence(params) → kết quả backtest + nguồn + giới hạn
 *  - getLiveSnapshot()           → số đo tồn kho THẬT của tenant (không mô phỏng)
 *
 * Ghi chú trung thực: dữ liệu backtest là CÔNG KHAI (UCI Online Retail II, CC BY 4.0)
 * và kết quả là MÔ PHỎNG. `live-snapshot` mới là dữ liệu doanh nghiệp đang chạy.
 */
import axios from './axios';

const unwrap = (r) => r.data?.data ?? r.data;

export const getBacktestEvidence = (params) =>
  axios.get('/evidence/backtest', { params }).then(unwrap);

export const getLiveSnapshot = () => axios.get('/evidence/live-snapshot').then(unwrap);