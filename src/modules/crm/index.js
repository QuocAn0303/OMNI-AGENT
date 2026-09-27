/**
 * modules/crm/index.js — Tổng hợp routes CRM
 * 
 * Tổng quan:
 * - File index tổng hợp tất cả sub-routes của module CRM dưới một router duy nhất.
 * - Mount các routes: /notes, /tags, /tasks, /segments, /campaigns.
 * 
 * Hàm:
 * - Router sử dụng sub-routes từ: notes.routes, tags.routes, tasks.routes, segments.routes, campaigns.routes.
 */
// src/modules/crm/index.js
const router = require("express").Router();

router.use("/notes", require("./notes.routes"));
router.use("/tags", require("./tags.routes"));
router.use("/tasks", require("./tasks.routes"));
router.use("/segments", require("./segments.routes"));
router.use("/campaigns", require("./campaigns.routes"));
router.use("/webhook-lead", require("./webhook-lead.routes"));

module.exports = router;
