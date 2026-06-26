/**
 * Frontend: src/api/debts.js — API module Công nợ
 *
 * Tổng quan:
 * - Quản lý công nợ phải thu / phải trả
 * - getDebts: lấy danh sách công nợ (có params lọc)
 * - getDebtsSummary: lấy tổng quan công nợ
 * - postDebtPayment: ghi nhận thanh toán cho một khoản nợ
 *
 * Exports:
 * - getDebts, getDebtsSummary, postDebtPayment
 */
import axios from "./axios";

const unwrap = (res) => res.data?.data ?? res.data;

export const getDebts = (params) => axios.get("/debts", { params }).then(unwrap);
export const getDebtsSummary = () => axios.get("/debts/summary").then(unwrap);
export const postDebtPayment = (id, body) => axios.post(`/debts/${id}/payments`, body).then(unwrap);
