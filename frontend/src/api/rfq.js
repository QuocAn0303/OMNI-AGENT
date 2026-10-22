/**
 * api/rfq.js — RFQ và so sánh báo giá nhà cung cấp
 */
import axios from './axios';

const unwrap = (r) => r.data?.data ?? r.data;

export const listRFQs = (params) => axios.get('/rfq', { params }).then(unwrap);
export const getRFQ = (id) => axios.get(`/rfq/${id}`).then(unwrap);
export const getRFQComparison = (id) => axios.get(`/rfq/${id}/comparison`).then(unwrap);
export const createRFQ = (data) => axios.post('/rfq', data).then(unwrap);
// lines: [{ rfqItemId, unitCost, availableQty }]
export const recordQuote = (rfqId, vendorId, data) =>
  axios.post(`/rfq/${rfqId}/quotes`, { vendorId, ...data }).then(unwrap);
export const declineQuote = (rfqId, vendorId, declineReason) =>
  axios.post(`/rfq/${rfqId}/quotes/decline`, { vendorId, declineReason }).then(unwrap);
export const awardRFQ = (rfqId, vendorId, note) =>
  axios.post(`/rfq/${rfqId}/award`, { vendorId, note }).then(unwrap);
export const cancelRFQ = (rfqId, reason) =>
  axios.post(`/rfq/${rfqId}/cancel`, { reason }).then(unwrap);