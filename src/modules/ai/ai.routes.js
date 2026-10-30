// src/modules/ai/ai.routes.js
const express = require("express");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const aiService = require("./ai.service");

const router = express.Router();

// Chat voi AI assistant (RAG)
// `authenticate` TRƯỚC `requireModule`: requireModule đọc `req.user.tenantId`,
// không có token thì không có tenant ⇒ paywall không chặn được.
router.use(authenticate, requireModule("ai"));

router.post("/chat", aiService.chat);

// Goi y proactive
router.get("/suggestions", authorize("ADMIN", "MANAGER"), aiService.getSuggestions);

// Trigger sync dữ liệu ERP -> vector store (admin only)
router.post("/sync", authorize("ADMIN"), aiService.triggerSync);

module.exports = router;
