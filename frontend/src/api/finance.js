/**
 * Frontend: src/api/finance.js — API module Tài chính
 *
 * Tổng quan:
 * - Chứa các endpoint tài chính dùng chung
 * - Hiện tại chỉ có getBankAccounts (lấy danh sách tài khoản ngân hàng)
 *
 * Exports:
 * - getBankAccounts: Lấy danh sách tài khoản ngân hàng
 */
// frontend/src/api/finance.js — endpoint tài chính dùng chung (bank account, v.v.)
import axios from "./axios";

const unwrap = (res) => res.data?.data ?? res.data;

export const getBankAccounts = () => axios.get("/bank-reco/bank-accounts").then(unwrap);
