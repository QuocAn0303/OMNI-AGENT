// frontend/src/api/lots.js
import axios from "./axios";
const unwrap = (res) => res.data?.data ?? res.data;

export const getLots         = (params)     => axios.get("/production/lots", { params }).then(unwrap);
export const getExpiringLots = (days = 30)  => axios.get("/production/lots/expiring", { params: { days } }).then(unwrap);
export const getLot          = (id)         => axios.get(`/production/lots/${id}`).then(unwrap);
export const receiveLot      = (data)       => axios.post("/production/lots/receive", data).then(unwrap);
export const consumeLot      = (id, qty, extra) => axios.post(`/production/lots/${id}/consume`, { quantity: qty, ...extra }).then(unwrap);
