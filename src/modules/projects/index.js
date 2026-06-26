/**
 * modules/projects/index.js — Điểm vào module Projects
 *
 * Tổng quan:
 * - Mount tất cả sub-routers cho module dự án
 * - Cung cấp endpoint /assignable-users để lấy danh sách user thêm vào dự án
 * - Yêu cầu authenticate
 *
 * Hàm:
 * - GET /assignable-users → memberService.assignableUsers: Danh sách user active để gán task/thêm member
 * - /:id/tasks → task.routes: Mount router công việc dự án
 * - /:id/members → member.routes: Mount router thành viên dự án
 * - /:id/timesheet → timesheet.routes: Mount router timesheet dự án
 * - / → project.routes: Mount router dự án (để sau cùng tránh xung đột route tham số)
 */
// src/modules/projects/index.js
const router = require("express").Router();
const memberService = require("./member.service");
const { authenticate } = require("../../middleware/auth.middleware");
const { success } = require("../../utils/response");

// GET /api/projects/assignable-users — danh sách user để thêm thành viên / gán task
router.get("/assignable-users", authenticate, async (req, res, next) => {
  try {
    success(res, await memberService.assignableUsers());
  } catch (err) {
    next(err);
  }
});

router.use("/:id/tasks", require("./task.routes"));
router.use("/:id/members", require("./member.routes"));
router.use("/:id/timesheet", require("./timesheet.routes"));
router.use("/", require("./project.routes"));

module.exports = router;
