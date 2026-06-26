/**
 * Frontend: src/api/workflow.js — API module Quy trình phê duyệt (Workflow)
 *
 * Tổng quan:
 * - Các endpoint CRUD cho workflow và approval
 * - getWorkflows, createWorkflow, updateWorkflow: quản lý luồng phê duyệt
 * - getWorkflowRun: xem chi tiết một lần chạy workflow
 * - decideApproval: phê duyệt / từ chối một approval
 *
 * Exports:
 * - getWorkflows, createWorkflow, updateWorkflow, getWorkflowRun, decideApproval
 */
// frontend/src/api/workflow.js
import axios from "./axios";
const unwrap = (res) => res.data?.data ?? res.data;

export const getWorkflows  = ()           => axios.get("/workflows").then(unwrap);
export const createWorkflow = (data)      => axios.post("/workflows", data).then(unwrap);
export const updateWorkflow = (id, data)  => axios.patch(`/workflows/${id}`, data).then(unwrap);
export const getWorkflowRun = (runId)     => axios.get(`/workflows/runs/${runId}`).then(unwrap);
export const decideApproval = (id, data)  => axios.post(`/workflows/approvals/${id}/decide`, data).then(unwrap);
export const getPendingApprovals = ()     => axios.get("/workflows/approvals/pending").then(unwrap);
export const getRuns = (page, limit)      => axios.get("/workflows/runs", { params: { page, limit } }).then(unwrap);
export const requestLeave = (data)        => axios.post("/hr/leave", data).then(unwrap);
export const getLeaves = (employeeId)     => axios.get(`/hr/leave/${employeeId || ""}`).then((r) => r.data?.data);
