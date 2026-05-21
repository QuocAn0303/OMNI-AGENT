// src/modules/crm/index.js
const router = require("express").Router();

router.use("/notes", require("./notes.routes"));
router.use("/tags", require("./tags.routes"));
router.use("/tasks", require("./tasks.routes"));
router.use("/segments", require("./segments.routes"));

module.exports = router;
