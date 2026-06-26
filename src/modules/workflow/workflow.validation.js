const { z } = require("zod");

const createWorkflowSchema = z.object({
  name: z.string().min(1, "Tên workflow không được để trống"),
  trigger: z.enum(["EXPENSE_ABOVE", "PO_ABOVE", "LEAVE_REQUEST", "CUSTOM"]),
  config: z.object({
    threshold: z.number().min(0).optional(),
  }).optional().default({}),
  steps: z.array(z.object({
    sequence: z.number().int().min(1),
    type: z.enum(["APPROVAL", "NOTIFICATION"]),
    config: z.object({
      approverId: z.string().optional(),
    }).optional().default({}),
  })).min(1, "Workflow cần ít nhất 1 bước"),
});

const updateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  trigger: z.enum(["EXPENSE_ABOVE", "PO_ABOVE", "LEAVE_REQUEST", "CUSTOM"]).optional(),
  config: z.object({
    threshold: z.number().min(0).optional(),
  }).optional(),
  isActive: z.boolean().optional(),
});

const decideSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().max(500).optional(),
});

module.exports = {
  createWorkflowSchema,
  updateWorkflowSchema,
  decideSchema,
};
