/**
 * Frontend: src/api/currency.js — API module Quản lý tiền tệ
 *
 * Tổng quan:
 * - Quản lý danh sách tiền tệ và tỷ giá hối đoái
 * - getCurrencies: lấy danh sách tiền tệ
 * - getRateHistory: lấy lịch sử tỷ giá của một mã tiền tệ
 * - setExchangeRate: cập nhật tỷ giá, upsertCurrency: thêm/sửa tiền tệ
 *
 * Exports:
 * - getCurrencies, getRateHistory, setExchangeRate, upsertCurrency
 */
// frontend/src/api/currency.js
import axios from "./axios";

const unwrap = (res) => res.data?.data ?? res.data;

export const getCurrencies    = ()              => axios.get("/currencies").then(unwrap);
export const getRateHistory   = (code, params)  => axios.get(`/currencies/${code}/rates`, { params }).then(unwrap);
export const setExchangeRate  = (code, data)    => axios.post(`/currencies/${code}/rates`, data).then(unwrap);
export const upsertCurrency   = (data)          => axios.post("/currencies", data).then(unwrap);
