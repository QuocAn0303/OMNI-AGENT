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
router.use("/", require("./project.routes"));

module.exports = router;
