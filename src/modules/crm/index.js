/**
 * modules/crm/index.js — Tổng hợp routes CRM
 *
 * Tổng quan:
 * - File index tổng hợp tất cả sub-routes của module CRM dưới một router duy nhất.
 * - Nhóm 1 — CRM giao dịch (Marketing Hỗ Trợ): notes, tags, tasks, segments, campaigns.
 * - Nhóm 2 — Sales Pipeline (Lead / Deal / Organization / Contact): stages, leads,
 *   deals, organizations, contacts, dashboard. Tất cả dùng `requireModule("crm")`
 *   nên không cần khai báo thêm module mới trong seed plan.
 * - Nhóm 3 — Webhook lead đa kênh (mount ở /webhook-lead, prefix /api/webhook).
 * - Nhóm 4 — Đo mở/click + từ chối nhận tin (public, mount ở /track, xác thực bằng
 *   token ngẫu nhiên trong link chứ không phải JWT — mail client không có JWT).
 *   Cố ý KHÔNG bọc authenticate ở tầng index.
 *
 * Hàm:
 * - Router sử dụng sub-routes từ: notes, tags, tasks, segments, campaigns,
 *   stages, leads, deals, organizations, contacts, dashboard, webhook-lead,
 *   campaign-tracking.
 */
// src/modules/crm/index.js
const router = require("express").Router();

// --- CRM giao dịch ---
router.use("/notes", require("./notes.routes"));
router.use("/tags", require("./tags.routes"));
router.use("/tasks", require("./tasks.routes"));
router.use("/segments", require("./segments.routes"));
router.use("/campaigns", require("./campaigns.routes"));

// --- Sales Pipeline ---
router.use("/stages", require("./stages.routes"));
router.use("/leads", require("./leads.routes"));
router.use("/deals", require("./deals.routes"));
router.use("/organizations", require("./organizations.routes"));
router.use("/contacts", require("./contacts.routes"));
router.use("/dashboard", require("./dashboard.routes"));

// --- Cây báo cáo (Sales hierarchy) — xem cây + gán quản lý trực tiếp ---
router.use("/hierarchy", require("./hierarchy.routes"));

// --- Webhook lead (public, xác thực X-Tenant-Key) ---
router.use("/webhook-lead", require("./webhook-lead.routes"));

// --- Đo + từ chối chiến dịch (public, xác thực token trong link — KHÔNG dùng JWT) ---
router.use("/track", require("./campaign-tracking.routes"));

module.exports = router;
