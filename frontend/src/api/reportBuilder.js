/**
 * Frontend: src/api/reportBuilder.js — API module Xây dựng báo cáo (Report Builder)
 *
 * Tổng quan:
 * - Cho phép tạo, sửa, xoá, chạy báo cáo tuỳ chỉnh
 * - getTables: lấy danh sách bảng có sẵn để xây dựng query
 * - runAdHoc: chạy báo cáo ad-hoc với config động
 * - runSavedReport: chạy lại báo cáo đã lưu
 *
 * Exports:
 * - getTables, getReports, createReport, updateReport, deleteReport, runAdHoc, runSavedReport
 */
// frontend/src/api/reportBuilder.js
import axios from "./axios";
const unwrap = (res) => res.data?.data ?? res.data;

export const getTables       = ()           => axios.get("/report-builder/tables").then(unwrap);
export const getReports      = ()           => axios.get("/report-builder").then(unwrap);
export const createReport    = (data)       => axios.post("/report-builder", data).then(unwrap);
export const updateReport    = (id, data)   => axios.patch(`/report-builder/${id}`, data).then(unwrap);
export const deleteReport    = (id)         => axios.delete(`/report-builder/${id}`).then(unwrap);
export const runAdHoc        = (config)     => axios.post("/report-builder/run", config).then(unwrap);
export const runSavedReport  = (id)         => axios.post(`/report-builder/${id}/run`).then(unwrap);
