// frontend/src/api/einvoice.js
import axios from "./axios";

const unwrap = (res) => res.data?.data ?? res.data;

export const getEInvoices = (params) => axios.get("/einvoice", { params }).then(unwrap);
export const getEInvoice  = (id)     => axios.get(`/einvoice/${id}`).then(unwrap);
export const issueEInvoice = (orderId) => axios.post(`/einvoice/order/${orderId}/issue`).then(unwrap);
export const cancelEInvoice = (id)   => axios.post(`/einvoice/${id}/cancel`).then(unwrap);
export const syncEInvoice = (id)     => axios.post(`/einvoice/${id}/sync`).then(unwrap);
