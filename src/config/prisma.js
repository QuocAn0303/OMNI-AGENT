/**
 * config/prisma.js — Prisma Client + Multi-tenant auto-scoping
 *
 * - Prisma extension ($extends) auto-inject tenantId vào mọi query
 * - tenantId lấy từ AsyncLocalStorage (tenantContext.js) → set bởi tenant.middleware
 * - SUPER_OMEGA_ULTRA_ADMIN: bypass scoping (xem tất cả tenant)
 * - Model không có tenantId column → KHÔNG bị scope (tránh crash)
 *
 * Cơ chế:
 *   findMany/findFirst/findUnique/count → where: { ...where, tenantId }
 *   create/createMany → data: { ...data, tenantId }
 *   update/updateMany/delete/deleteMany → where: { ...where, tenantId }
 *   upsert → where + create
 */
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const { getTenantId, isBypassTenant } = require("./tenantContext");

const url = new URL(process.env.DATABASE_URL);
const pool = new Pool({
  host: url.hostname,
  port: parseInt(url.port || "5432"),
  database: url.pathname.slice(1).split("?")[0],
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  max: Number(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

const adapter = new PrismaPg(pool);
const basePrisma = new PrismaClient({ adapter });

const TENANT_SCOPED_MODELS = new Set([
  "Product", "Category", "Customer", "Order", "OrderItem", "OrderItemModifier",
  "Inventory", "InventoryTransaction", "Warehouse", "Vendor",
  "BankAccount", "BankTransaction", "BankStatement", "BankStatementLine",
  "Expense", "ExpenseCategory", "Debt", "DebtPayment",
  "Promotion", "PromotionUsage", "Invoice", "Payment",
  "CompanySettings", "TaxRate",
  "Employee", "Shift", "Payroll", "Violation", "OvertimeRequest", "TimeEntry",
  "JournalEntry", "JournalLine", "FiscalPeriod",
  "FixedAsset", "FixedAssetCategory", "DepreciationSchedule",
  "PettyCashTransaction", "PrepaidExpense", "RecurringExpenseLog",
  "JournalPostingError",
  "Area", "DinerTable", "TableSession", "Reservation",
  "KdsStation", "KdsTicket",
  "ModifierGroup", "ModifierOption", "ProductVariant", "Combo", "ComboItem",
  "Recipe", "RecipeIngredient", "WasteLog",
  "StampCard", "StampCardTemplate",
  "Printer", "ReturnLineItem",
  "Department", "InternalDocument",
  "FoodDeliveryOrder", "QrOrderSession",
  "BillSplit", "BillSplitItem",
  "Delivery", "DeliveryEvent",
  "PurchaseOrder", "PurchaseItem",
  "StockTransfer", "StockTransferItem",
  "CycleCount", "CycleCountItem",
  "SerialNumber", "InventoryLot", "LotTransaction",
  "ElectronicInvoice",
  "LoyaltyTransaction", "StoreCreditTransaction",
  "CustomerNote", "CustomerTag", "CustomerTagOnCustomer", "CustomerTask", "CustomerSegment",
  "CampaignRecipient", "CampaignTracking", "CustomerCampaign",
  "MarketplaceListing", "MarketplaceSyncLog", "MarketplaceShop",
  "Notification",
  "OrderReturn",
  "QualityCheck", "QualityCheckItem",
  "WorkCenter", "Routing", "RoutingOperation", "WorkOrder", "WorkOrderItem",
  "Bom", "BomItem",
  "Project", "ProjectInvoice", "ProjectMember", "ProjectTask",
  "AiForecast", "AiRecommendation",
  "ReportSchedule", "SavedReport",
  "PortalSession", "PortalOtp",
  "IntegrationConfig",
  "WebhookEndpoint",
  "Workflow", "WorkflowApproval", "WorkflowRun", "WorkflowStep",
  "User", "AgentSession", "SupportAccessSession", "TenantSubscription", "SubscriptionInvoice",
  "AuditLog", "AgentStep", "AgentHumanGate", "AgentFeedback", "BackupCode", "WebhookDelivery",
  "RefreshToken",
  // CRM/SRM upgrade (2026-09): churn win-back + 3-way matching + GRN
  "ChurnAlert", "GoodsReceiptNote", "GoodsReceiptItem", "PurchaseInvoiceRecord",
  // CRM Sales Pipeline (2026-09): Lead / Deal / Organization / Contact
  "CrmPipelineStage", "CrmLead", "CrmOrganization", "CrmContact",
  "CrmDeal", "CrmDealItem", "CrmCommunication",
]);

const READ_OPS = new Set([
  "findMany", "findFirst", "findFirstOrThrow",
  "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy",
]);
const WHERE_OPS = new Set([
  "update", "updateMany", "delete", "deleteMany", "upsert",
]);
const DATA_OPS = new Set([
  "create", "createMany", "createManyAndReturn", "upsert",
]);

const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const tenantId = getTenantId();
        const bypass = isBypassTenant();

        if (!tenantId || bypass || !TENANT_SCOPED_MODELS.has(model)) {
          return query(args);
        }

        if (!args) args = {};

        if (READ_OPS.has(operation)) {
          args.where = { ...args.where, tenantId };
        } else if (WHERE_OPS.has(operation)) {
          if (args.where) args.where = { ...args.where, tenantId };
          if (operation === "upsert" && args.create) {
            args.create = { ...args.create, tenantId };
          }
        } else if (DATA_OPS.has(operation)) {
          if (operation === "create" && args.data) {
            if (!args.data.tenantId) args.data = { ...args.data, tenantId };
          } else if (operation === "createMany" || operation === "createManyAndReturn") {
            if (Array.isArray(args.data)) {
              args.data = args.data.map((d) => (d.tenantId ? d : { ...d, tenantId }));
            }
          } else if (operation === "upsert") {
            if (args.where) args.where = { ...args.where, tenantId };
            if (args.create && !args.create.tenantId) {
              args.create = { ...args.create, tenantId };
            }
          }
        }

        return query(args);
      },
    },
  },
});

module.exports = prisma;
