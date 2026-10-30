const router = require("express").Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const svc = require("./workflow.service");
const { sendSuccess } = require("../../utils/response");
const { createWorkflowSchema, updateWorkflowSchema, decideSchema } = require("./workflow.validation");
const mgr = ["ADMIN", "MANAGER"];

router.use(authenticate, requireModule("workflows"));

router.get("/", authenticate, authorize(...mgr), async (req, res, next) => {
  try { sendSuccess(res, await svc.listWorkflows()); } catch (e) { next(e); }
});

router.post("/", authenticate, authorize("ADMIN"), async (req, res, next) => {
  try {
    const data = createWorkflowSchema.parse(req.body);
    sendSuccess(res, await svc.createWorkflow(req.user.id, data));
  } catch (e) { next(e); }
});

router.patch("/:id", authenticate, authorize("ADMIN"), async (req, res, next) => {
  try {
    const data = updateWorkflowSchema.parse(req.body);
    sendSuccess(res, await svc.updateWorkflow(req.params.id, data));
  } catch (e) { next(e); }
});

router.get("/runs/:runId", authenticate, authorize(...mgr), async (req, res, next) => {
  try { sendSuccess(res, await svc.getRun(req.params.runId)); } catch (e) { next(e); }
});

router.post("/approvals/:id/decide", authenticate, async (req, res, next) => {
  try {
    const { status, comment } = decideSchema.parse(req.body);
    sendSuccess(res, await svc.decide(req.params.id, req.user.id, { status, comment }));
  } catch (e) { next(e); }
});

// List pending approvals for current user
router.get("/approvals/pending", authenticate, async (req, res, next) => {
  try {
    sendSuccess(res, await svc.getPendingApprovals(req.user.id));
  } catch (e) { next(e); }
});

// List all workflow runs (admin/manager)
router.get("/runs", authenticate, authorize(...mgr), async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    sendSuccess(res, await svc.listRuns({ page, limit }));
  } catch (e) { next(e); }
});

// Mục 7: seed template duyệt PO đa cấp theo hạn mức (5tr/50tr) — ADMIN, idempotent
router.post("/seed-po-template", authenticate, authorize("ADMIN"), async (req, res, next) => {
  try {
    const { seedPoApprovalWorkflows } = require("./po-template.seed");
    sendSuccess(res, await seedPoApprovalWorkflows(req.user.id), "Đã seed workflow duyệt PO đa cấp");
  } catch (e) { next(e); }
});

module.exports = router;
