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
 *
 * Hàm:
 * - Router sử dụng sub-routes từ: notes, tags, tasks, segments, campaigns,
 *   stages, leads, deals, organizations, contacts, dashboard, webhook-lead.
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

// --- Webhook lead (public, xác thực X-Tenant-Key) ---
router.use("/webhook-lead", require("./webhook-lead.routes"));

module.exports = router;
