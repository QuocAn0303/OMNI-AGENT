/**
 * modules/workflow/po-template.seed.js — Seed template duyệt PO đa cấp theo hạn mức (Mục 7)
 *
 * Ngưỡng theo đặc tả:
 *   < 5.000.000đ  → auto-approve (workflow KHÔNG kích hoạt vì evaluateCondition threshold)
 *   5tr – 50tr    → workflow "Duyệt PO 5tr-50tr" (MANAGER duyệt)
 *   > 50.000.000đ → workflow "Duyệt PO tren 50tr" (ADMIN duyệt)
 *
 * PHÂN CÔNG với AgentHumanGate (không xung đột):
 * - AgentHumanGate: CHỈ chặn PO tạo bởi AI Agent (tool `create_po` của db-agent) —
 *   kiểm ngưỡng chi tiêu trước khi AI thực thi.
 * - WorkflowApproval (file này): áp dụng cho PO tạo THỦ CÔNG qua submit().
 *   Ghi chú này phải giữ nguyên ở cả 2 nơi để dev sau không nhầm.
 */
const prisma = require("../../config/prisma");
const logger = require("../../utils/logger");

const TEMPLATES = [
  {
    name: "Duyệt PO 5tr-50tr (MANAGER)",
    role: "MANAGER",
    config: { threshold: 5_000_000, minAmount: 5_000_000, maxAmount: 50_000_000 },
  },
  {
    name: "Duyệt PO tren 50tr (ADMIN)",
    role: "ADMIN",
    config: { threshold: 50_000_000, minAmount: 50_000_000 },
  },
];

// Seed 2 workflow PO_ABOVE cho tenant hiện tại (idempotent theo tên + trigger)
const seedPoApprovalWorkflows = async (userId = null) => {
  const results = [];
  for (const tpl of TEMPLATES) {
    const exists = await prisma.workflow.findFirst({
      where: { name: tpl.name, trigger: "PO_ABOVE" },
      select: { id: true },
    });
    if (exists) {
      results.push({ name: tpl.name, created: false });
      continue;
    }
    // Bước APPROVAL của engine yêu cầu step.config.approverId — chọn user role tương ứng
    const approver = await prisma.user.findFirst({
      where: { role: tpl.role, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const wf = await prisma.workflow.create({
      data: {
        name: tpl.name,
        trigger: "PO_ABOVE",
        config: tpl.config,
        createdById: userId || approver?.id,
        steps: {
          create: [
            {
              sequence: 1,
              type: "APPROVAL",
              config: approver
                ? { approverId: approver.id, role: tpl.role }
                : { role: tpl.role },
            },
          ],
        },
      },
      select: { id: true, name: true },
    });
    results.push({ name: tpl.name, created: true, workflowId: wf.id });
  }
  logger.info(`[workflow-seed] PO templates: ${results.map((r) => `${r.name}=${r.created ? "created" : "exists"}`).join(", ")}`);
  return results;
};

module.exports = { seedPoApprovalWorkflows, TEMPLATES };
