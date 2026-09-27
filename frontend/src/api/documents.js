import axios from "./axios";

const unwrap = (res) => res.data?.data ?? res.data;
const unwrapPaginated = (res) => res.data;

export const getDocuments = (params) => axios.get("/documents", { params }).then(unwrapPaginated);
export const getMyDocuments = () => axios.get("/documents/my").then(unwrap);
export const getDocument = (id) => axios.get(`/documents/${id}`).then(unwrap);
export const createDocument = (formData) => axios.post("/documents", formData, {
  headers: { "Content-Type": "multipart/form-data" },
}).then((res) => res.data);
export const getDocumentFileUrl = (id) => `/api/documents/${id}/file`;
export const deleteDocument = (id) => axios.delete(`/documents/${id}`).then((res) => res.data);

export const getDepartments = () => axios.get("/hr/departments").then(unwrap);
export const createDepartment = (data) => axios.post("/hr/departments", data).then((res) => res.data);
export const updateDepartment = (id, data) => axios.put(`/hr/departments/${id}`, data).then((res) => res.data);
export const deleteDepartment = (id) => axios.delete(`/hr/departments/${id}`).then((res) => res.data);
