// src/modules/notifications/notification.routes.js
const router = require("express").Router();
const { authenticate } = require("../../middleware/auth.middleware");
const { success } = require("../../utils/response");
const notificationService = require("./notification.service");

router.use(authenticate);

router.get("/", async (req, res, next) => {
  try {
    success(res, await notificationService.listForUser(req.user, req.query));
  } catch (e) {
    next(e);
  }
});

router.get("/unread-count", async (req, res, next) => {
  try {
    success(res, await notificationService.unreadCount(req.user));
  } catch (e) {
    next(e);
  }
});

router.patch("/read-all", async (req, res, next) => {
  try {
    success(res, await notificationService.markAllRead(req.user), "Đã đọc tất cả");
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/read", async (req, res, next) => {
  try {
    success(res, await notificationService.markRead(req.params.id, req.user), "Đã đọc");
  } catch (e) {
    next(e);
  }
});

module.exports = router;
