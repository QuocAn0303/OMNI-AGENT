const express = require("express");
const { handleCommand } = require("./ai.service");

const router = express.Router();

router.post("/command", handleCommand);

module.exports = router;
