// frontend/src/api/bankReco.js
import axios from "./axios";

const unwrap = (res) => res.data?.data ?? res.data;

export const getStatements    = (params) => axios.get("/bank-reco/statements", { params }).then(unwrap);
export const getStatementLines = (id, params) => axios.get(`/bank-reco/statements/${id}/lines`, { params }).then(unwrap);
export const importStatement  = (formData) => axios.post("/bank-reco/statements/import", formData, { headers: { "Content-Type": "multipart/form-data" } }).then(unwrap);
export const autoMatch        = (id)       => axios.post(`/bank-reco/statements/${id}/auto-match`).then(unwrap);
export const manualMatch      = (lineId, entryId) => axios.patch(`/bank-reco/lines/${lineId}/match`, { entryId }).then(unwrap);
export const unmatch          = (lineId)   => axios.patch(`/bank-reco/lines/${lineId}/unmatch`).then(unwrap);
export const createAdjustment = (lineId, data) => axios.post(`/bank-reco/lines/${lineId}/adjustment`, data).then(unwrap);
