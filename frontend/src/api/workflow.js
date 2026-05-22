// frontend/src/api/workflow.js
import axios from "./axios";
const unwrap = (res) => res.data?.data ?? res.data;

export const getWorkflows  = ()           => axios.get("/workflows").then(unwrap);
export const createWorkflow = (data)      => axios.post("/workflows", data).then(unwrap);
export const updateWorkflow = (id, data)  => axios.patch(`/workflows/${id}`, data).then(unwrap);
export const getWorkflowRun = (runId)     => axios.get(`/workflows/runs/${runId}`).then(unwrap);
export const decideApproval = (id, data)  => axios.post(`/workflows/approvals/${id}/decide`, data).then(unwrap);
