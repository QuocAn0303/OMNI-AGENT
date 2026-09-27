// src/modules/ai/ai.routes.js
const express = require("express");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const aiService = require("./ai.service");

const router = express.Router();

// Chat voi AI assistant (RAG)
router.post("/chat", authenticate, aiService.chat);

// Goi y proactive
router.get("/suggestions", authenticate, authorize("ADMIN", "MANAGER"), aiService.getSuggestions);

// Trigger sync dữ liệu ERP -> vector store (admin only)
router.post("/sync", authenticate, authorize("ADMIN"), aiService.triggerSync);

module.exports = router;
