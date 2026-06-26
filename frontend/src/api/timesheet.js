/**
 * Frontend: src/api/timesheet.js — API module Timesheet (Dự án)
 *
 * Tổng quan:
 * - Quản lý chấm công theo dự án: CRUD time entries
 * - Quản lý hoá đơn dự án: lấy, tạo, cập nhật invoice
 * - Tất cả endpoint đều thuộc /projects/:projectId/*
 *
 * Exports:
 * - getTimeEntries, createTimeEntry, updateTimeEntry, deleteTimeEntry
 * - getProjectInvoices, generateProjectInvoice, updateProjectInvoice
 */
// frontend/src/api/timesheet.js
import axios from "./axios";
const unwrap = (res) => res.data?.data ?? res.data;

export const getTimeEntries   = (projectId, params)  => axios.get(`/projects/${projectId}/timesheet`, { params }).then(unwrap);
export const createTimeEntry  = (projectId, data)    => axios.post(`/projects/${projectId}/timesheet`, data).then(unwrap);
export const updateTimeEntry  = (projectId, id, data) => axios.patch(`/projects/${projectId}/timesheet/${id}`, data).then(unwrap);
export const deleteTimeEntry  = (projectId, id)      => axios.delete(`/projects/${projectId}/timesheet/${id}`).then(unwrap);
export const getProjectInvoices   = (projectId)      => axios.get(`/projects/${projectId}/invoices`).then(unwrap);
export const generateProjectInvoice = (projectId, data) => axios.post(`/projects/${projectId}/invoices/generate`, data).then(unwrap);
export const updateProjectInvoice = (projectId, invId, data) => axios.patch(`/projects/${projectId}/invoices/${invId}`, data).then(unwrap);
