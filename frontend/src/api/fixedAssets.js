// frontend/src/api/fixedAssets.js
import axios from "./axios";

const unwrap = (res) => res.data?.data ?? res.data;

export const getAssets       = (params) => axios.get("/fixed-assets", { params }).then(unwrap);
export const getAsset        = (id)     => axios.get(`/fixed-assets/${id}`).then(unwrap);
export const createAsset     = (data)   => axios.post("/fixed-assets", data).then(unwrap);
export const disposeAsset    = (id, data) => axios.post(`/fixed-assets/${id}/dispose`, data).then(unwrap);
export const getCategories   = ()       => axios.get("/fixed-assets/categories").then(unwrap);
export const createCategory  = (data)   => axios.post("/fixed-assets/categories", data).then(unwrap);
export const runDepreciation = (data)   => axios.post("/fixed-assets/depreciation/run", data).then(unwrap);
