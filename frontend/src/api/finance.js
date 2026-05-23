// frontend/src/api/finance.js — endpoint tài chính dùng chung (bank account, v.v.)
import axios from "./axios";

const unwrap = (res) => res.data?.data ?? res.data;

export const getBankAccounts = () => axios.get("/bank-reco/bank-accounts").then(unwrap);
