// frontend/src/api/marketplace.js
import axios from "./axios";
const unwrap = (res) => res.data?.data ?? res.data;

export const getShops        = ()                => axios.get("/marketplace/shops").then(unwrap);
export const createShop      = (data)            => axios.post("/marketplace/shops", data).then(unwrap);
export const toggleShop      = (id, isActive)    => axios.patch(`/marketplace/shops/${id}/toggle`, { isActive }).then(unwrap);
export const getListings     = (shopId)          => axios.get(`/marketplace/shops/${shopId}/listings`).then(unwrap);
export const upsertListing   = (shopId, data)    => axios.post(`/marketplace/shops/${shopId}/listings`, data).then(unwrap);
export const getSyncLogs     = (shopId)          => axios.get(`/marketplace/shops/${shopId}/logs`).then(unwrap);
export const pushInventory   = (shopId)          => axios.post(`/marketplace/shops/${shopId}/push-inventory`).then(unwrap);
export const pullOrders      = (shopId)          => axios.post(`/marketplace/shops/${shopId}/pull-orders`).then(unwrap);
