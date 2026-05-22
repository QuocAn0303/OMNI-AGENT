// frontend/src/api/taxReport.js
import axios from "./axios";

const unwrap = (res) => res.data?.data ?? res.data;

export const getVATReport    = (params) => axios.get("/tax-reports/vat",  { params }).then(unwrap);
export const getPITReport    = (params) => axios.get("/tax-reports/pit",  { params }).then(unwrap);

export const downloadVATExcel = (params) =>
  axios.get("/tax-reports/vat/excel", { params, responseType: "blob" });

export const downloadVATXML = (params) =>
  axios.get("/tax-reports/vat/xml", { params, responseType: "blob" });

export const downloadBHXHExcel = (params) =>
  axios.get("/tax-reports/bhxh/excel", { params, responseType: "blob" });
