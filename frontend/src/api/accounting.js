/**
 * Frontend: src/api/accounting.js — API module Kế toán
 *
 * Tổng quan:
 * - Định nghĩa các hàm gọi endpoint kế toán: tài khoản (Chart of Accounts), nhật ký (Journal)
 * - Quản lý nhà cung cấp (Vendors), chi phí (Expenses), đơn mua hàng (Purchase Orders)
 * - Báo cáo tài chính: Balance Sheet, Profit & Loss, Cash Flow, Trial Balance, General Ledger, Aging
 * - Quản lý kỳ kế toán (Fiscal Periods) và dashboard founder
 * - Mỗi hàm đều unwrap response qua res.data?.data ?? res.data
 *
 * Exports:
 * - getAccounts, getAccountTree, getAccountBalance, getJournalEntries, createJournalEntry, ...
 * - getVendors, getExpenses, getPurchaseOrders, getTaxRates, getBalanceSheet, getProfitLoss, ...
 * - getFiscalPeriods, closeFiscalPeriod, reopenFiscalPeriod, ...
 */
// frontend/src/api/accounting.js
import axios from "./axios";

export const unwrap = (res) => res.data?.data ?? res.data;

// ===== Chart of Accounts =====
export const getAccounts = (params) => axios.get("/accounting/accounts", { params }).then(unwrap);
export const getAccountTree = () => axios.get("/accounting/accounts/tree").then(unwrap);
export const getAccountBalance = (id, params) =>
  axios.get(`/accounting/accounts/${id}/balance`, { params }).then(unwrap);

// ===== Journal =====
export const getJournalEntries = (params) => axios.get("/accounting/journal", { params }).then(unwrap);
export const getJournalEntry = (id) => axios.get(`/accounting/journal/${id}`).then(unwrap);
export const createJournalEntry = (data) => axios.post("/accounting/journal", data).then(unwrap);
export const reverseJournalEntry = (id) => axios.post(`/accounting/journal/${id}/reverse`).then(unwrap);
export const recordCapitalContribution = (data) =>
  axios.post("/accounting/journal/capital-contribution", data).then(unwrap);

// ===== Vendors =====
export const getVendors = (params) => axios.get("/accounting/vendors", { params }).then(unwrap);
export const getVendor = (id) => axios.get(`/accounting/vendors/${id}`).then(unwrap);
export const createVendor = (data) => axios.post("/accounting/vendors", data).then(unwrap);
export const updateVendor = (id, data) => axios.put(`/accounting/vendors/${id}`, data).then(unwrap);
export const deleteVendor = (id) => axios.delete(`/accounting/vendors/${id}`).then(unwrap);

// ===== Expenses =====
export const getExpenses = (params) => axios.get("/accounting/expenses", { params }).then(unwrap);
export const getExpense = (id) => axios.get(`/accounting/expenses/${id}`).then(unwrap);
export const createExpense = (data) => axios.post("/accounting/expenses", data).then(unwrap);
export const approveExpense = (id) => axios.post(`/accounting/expenses/${id}/approve`).then(unwrap);
export const payExpense = (id, data) => axios.post(`/accounting/expenses/${id}/pay`, data).then(unwrap);
export const rejectExpense = (id) => axios.post(`/accounting/expenses/${id}/reject`).then(unwrap);
export const getExpenseCategories = () => axios.get("/accounting/expense-categories").then(unwrap);

// ===== Purchase Orders =====
export const getPurchaseOrders = (params) => axios.get("/purchase-orders", { params }).then(unwrap);
export const getPurchaseOrder = (id) => axios.get(`/purchase-orders/${id}`).then(unwrap);
export const createPurchaseOrder = (data) => axios.post("/purchase-orders", data).then(unwrap);
export const submitPurchaseOrder = (id) => axios.post(`/purchase-orders/${id}/submit`).then(unwrap);
export const approvePurchaseOrder = (id) => axios.post(`/purchase-orders/${id}/approve`).then(unwrap);
export const orderPurchaseOrder = (id) => axios.post(`/purchase-orders/${id}/order`).then(unwrap);
export const receivePurchaseOrder = (id) => axios.post(`/purchase-orders/${id}/receive`).then(unwrap);
export const payPurchaseOrder = (id, data) => axios.post(`/purchase-orders/${id}/payment`, data).then(unwrap);
export const cancelPurchaseOrder = (id) => axios.post(`/purchase-orders/${id}/cancel`).then(unwrap);

// ===== Tax =====
export const getTaxRates = () => axios.get("/accounting/tax-rates").then(unwrap);
export const getVatReport = (params) => axios.get("/accounting/reports/vat", { params }).then(unwrap);

// ===== Financial Reports =====
export const getBalanceSheet = (params) => axios.get("/accounting/reports/balance-sheet", { params }).then(unwrap);
export const getProfitLoss = (params) => axios.get("/accounting/reports/profit-loss", { params }).then(unwrap);
export const getCashFlow = (params) => axios.get("/accounting/reports/cash-flow", { params }).then(unwrap);
export const getTrialBalance = (params) => axios.get("/accounting/reports/trial-balance", { params }).then(unwrap);
export const getGeneralLedger = (params) => axios.get("/accounting/reports/general-ledger", { params }).then(unwrap);
export const getAgingReport = (params) => axios.get("/accounting/reports/aging", { params }).then(unwrap);

// ===== Founder Dashboard =====
export const getFounderDashboard = () => axios.get("/accounting/dashboard").then(unwrap);

// ===== Fiscal Periods =====
export const getFiscalPeriods = () => axios.get("/accounting/fiscal-periods").then(unwrap);
export const closeFiscalPeriod = (year, month) =>
  axios.post("/accounting/fiscal-periods/close", { year, month }).then(unwrap);
export const reopenFiscalPeriod = (year, month) =>
  axios.post("/accounting/fiscal-periods/reopen", { year, month }).then(unwrap);
