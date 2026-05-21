import axios from "./axios";

const unwrap = (res) => res.data?.data ?? res.data;

export const getDebts = (params) => axios.get("/debts", { params }).then(unwrap);
export const getDebtsSummary = () => axios.get("/debts/summary").then(unwrap);
export const postDebtPayment = (id, body) => axios.post(`/debts/${id}/payments`, body).then(unwrap);
