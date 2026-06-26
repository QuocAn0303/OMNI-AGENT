/**
 * app.js — Entry point chính của Backend ERP
 * 
 * Tổng quan:
 * - Khởi tạo Express app với đầy đủ middleware: compression, helmet, cors, morgan, xss-clean, hpp, rate-limit
 * - Mount tất cả routes từ 40+ module nghiệp vụ dưới /api/*
 * - Khởi động HTTP server + Socket.IO (real-time) + cron jobs + CDC (Change Data Capture cho AI agent)
 * - Tự động thử port nếu bị chiếm (EADDRINUSE) → tăng dần, tối đa 10 lần thử
 * - Ghi VITE_API_URL vào frontend/.env để đồng bộ port giữa backend và frontend dev
 * - Sentry error tracking (nếu có SENTRY_DSN)
 * 
 * Luồng khởi động:
 *   1. Load .env → init Sentry
 *   2. Tạo Express app → gắn middleware toàn cục
 *   3. Mount tất cả routes
 *   4. 404 handler → error handler (cuối cùng)
 *   5. startServer(): tạo HTTP server → init Socket.IO → start cron/CDC → lắng nghe port
 *   6. Nếu EADDRINUSE → thử port tiếp theo
 */

require("dotenv").config();

const Sentry = require("@sentry/node");
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
  });
}

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const hpp = require("hpp");
const xssClean = require("xss-clean");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./config/swagger");
const fs = require("fs");
const path = require("path");

const compression = require("compression");
const errorHandler = require("./middleware/error.middleware");

// Routes
const authRoutes = require("./modules/auth/auth.routes");
const userRoutes = require("./modules/users/user.routes");
const productRoutes = require("./modules/products/product.routes");
const orderRoutes = require("./modules/orders/order.routes");
const returnRoutes = require("./modules/returns/return.routes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");
const customerRoutes = require("./modules/customers/customer.routes");
const inventoryRoutes = require("./modules/inventory/inventory.routes");
const categoryRoutes = require("./modules/categories/category.routes");
const reportRoutes = require("./modules/reports/report.routes");
const auditRoutes = require("./modules/audit/audit.routes");
const hrRoutes = require("./modules/hr/hr.routes");
const analyticsRoutes = require("./modules/analytics/analytics.routes");
const aiRoutes = require("./modules/ai/ai.routes");
const posRoutes = require("./modules/pos/pos.routes");
const agentRoutes = require("./modules/ai/agent.routes");
const llmProxyRoutes = require("./modules/ai/agent.llm");
const dbAgentRoutes = require("./modules/ai/db-agent.routes");
const accountingRoutes = require("./modules/accounting/accounting.routes");
const debtRoutes = require("./modules/debt/debt.routes");
const notificationRoutes = require("./modules/notifications/notification.routes");
const purchaseOrderAliasRoutes = require("./modules/accounting/purchase-order.routes");
const promotionRoutes = require("./modules/promotions/promotion.routes");
const invoiceRoutes = require("./modules/orders/invoice.routes");
const storeCreditRoutes = require("./modules/customers/store-credit.routes");
const serialNumberRoutes = require("./modules/inventory/serial-number.routes");
const loyaltyRoutes = require("./modules/loyalty/loyalty.routes");
const deliveryRoutes = require("./modules/delivery/delivery.routes");
const warehouseRoutes = require("./modules/warehouses/warehouse.routes");
const stockTransferRoutes = require("./modules/warehouses/stock-transfer.routes");
const importRoutes = require("./modules/import/import.routes");
const settingsRoutes = require("./modules/settings/settings.routes");
const adminRoutes = require("./modules/admin/admin.routes");
const subscriptionRoutes = require("./modules/subscriptions/subscription.routes");
const crmRoutes = require("./modules/crm");
const projectRoutes = require("./modules/projects");
const productionRoutes = require("./modules/production");
const einvoiceRoutes = require("./modules/einvoice/einvoice.routes");
const taxReportRoutes = require("./modules/tax-report/tax-report.routes");
const bankRecoRoutes = require("./modules/bank-reco/bank-reco.routes");
const vietqrRoutes = require("./modules/vietqr/vietqr.routes");
const fixedAssetsRoutes = require("./modules/fixed-assets/fixed-assets.routes");
const currencyRoutes = require("./modules/currency/currency.routes");
const marketplaceRoutes = require("./modules/marketplace/marketplace.routes");
const reportBuilderRoutes = require("./modules/report-builder/report-builder.routes");
const workflowRoutes = require("./modules/workflow/workflow.routes");
const portalRoutes = require("./modules/portal/portal.routes");
const integrationRoutes = require("./modules/integrations/integration.routes");
const deliveryService = require("./modules/delivery/delivery.service");
const http = require("http");
const { initSocket } = require("./realtime/socket");
const { startCrons } = require("./jobs/cron");
const { startCDC } = require("./jobs/agent.cdc");

const app = express();
const corsOrigin =
  process.env.CORS_ORIGIN || process.env.CLIENT_URL || "http://localhost:5173";

// ==================== Middleware ====================
app.use(compression());
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(xssClean());
app.use(hpp());

const rateLimit = require('express-rate-limit')

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Quá nhiều request, vui lòng thử lại sau' }
})

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Quá nhiều lần đăng nhập, vui lòng thử lại sau 1 phút' }
})

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(
  "/api/webhooks/delivery",
  express.raw({ type: "application/json" }),
);
app.use(
  "/api/subscriptions/webhook",
  express.raw({ type: "application/json" }),
);
app.use(
  "/api/vietqr/webhook/payos",
  express.raw({ type: "application/json" }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post("/api/webhooks/delivery/:provider", async (req, res) => {
  try {
    const rawBody =
      req.body instanceof Buffer ? req.body.toString("utf8") : JSON.stringify(req.body);
    const payload = JSON.parse(rawBody);
    const signature = req.headers["x-ghtk-signature"] || req.headers["x-signature"];
    const result = await deliveryService.handleWebhook(
      req.params.provider,
      payload,
      signature,
      rawBody,
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message || "Webhook error",
    });
  }
});

if (process.env.NODE_ENV !== "production") {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// ==================== Routes ====================
app.use('/api', apiLimiter)
app.use('/api/auth/login', loginLimiter)

app.get("/", (req, res) => {
  res.json({ message: "Aduu - Hệ thống hoạch định nguồn lực doanh nghiệp", version: "2.0.0" });
});

// Health check endpoint
app.get("/api/health", async (req, res) => {
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    version: "1.0.0",
    checks: {},
  };

  // Check database
  try {
    const prisma = require("./config/prisma");
    await prisma.$queryRawUnsafe("SELECT 1");
    health.checks.database = { status: "ok" };
  } catch (e) {
    health.checks.database = { status: "error", message: e.message };
    health.status = "degraded";
  }

  // Check Redis
  try {
    const { redis } = require("./config/redis");
    if (redis && redis.status === "ready") {
      await redis.ping();
      health.checks.redis = { status: "ok" };
    } else {
      health.checks.redis = { status: "not_configured" };
    }
  } catch (e) {
    health.checks.redis = { status: "error", message: e.message };
    health.status = "degraded";
  }

  // Check Ollama
  try {
    const { checkOllamaHealth } = require("./modules/ai/ai.service");
    health.checks.ollama = await checkOllamaHealth();
    if (health.checks.ollama.status !== "ok") {
      health.status = "degraded";
    }
  } catch (e) {
    health.checks.ollama = { status: "error", message: e.message };
    health.status = "degraded";
  }

  // Memory usage
  const mem = process.memoryUsage();
  health.checks.memory = {
    rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
    heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
  };

  const statusCode = health.status === "ok" ? 200 : 503;
  res.status(statusCode).json(health);
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/returns", returnRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/hr", hrRoutes);
app.use("/api/analytics", analyticsRoutes);
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Qua nhieu request AI, vui long thu lai sau' },
});
app.use("/api/ai/chat", aiLimiter);
app.use("/api/ai/sync", aiLimiter);
app.use("/api/ai", aiRoutes);
app.use("/api/pos", posRoutes);
app.use("/api/agent", agentRoutes);
app.use("/api/llm", llmProxyRoutes);
app.use("/api/db-agent", dbAgentRoutes);
app.use("/api/accounting", accountingRoutes);
app.use("/api/debts", debtRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/purchase-orders", purchaseOrderAliasRoutes);
app.use("/api/promotions", promotionRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/store-credits", storeCreditRoutes);
app.use("/api/serial-numbers", serialNumberRoutes);
app.use("/api/loyalty", loyaltyRoutes);
app.use("/api/deliveries", deliveryRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/stock-transfers", stockTransferRoutes);
app.use("/api/import", importRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/crm", crmRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/production", productionRoutes);
app.use("/api/einvoice", einvoiceRoutes);
app.use("/api/tax-reports", taxReportRoutes);
app.use("/api/bank-reco", bankRecoRoutes);
app.use("/api/vietqr", vietqrRoutes);
app.use("/api/fixed-assets", fixedAssetsRoutes);
app.use("/api/currencies", currencyRoutes);
app.use("/api/marketplace", marketplaceRoutes);
app.use("/api/report-builder", reportBuilderRoutes);
app.use("/api/workflows", workflowRoutes);
app.use("/api/portal", portalRoutes);
app.use("/api/integrations", integrationRoutes);

// Sentry error handler (phải trước error middleware)
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} không tồn tại`,
  });
});

// Error handler (phải đặt cuối cùng)
app.use(errorHandler);

// ==================== Start Server ====================
// Khởi động server có xử lý lỗi EADDRINUSE: nếu cổng bị chiếm sẽ thử cổng tiếp theo
const DEFAULT_PORT = Number(process.env.PORT) || 4000; // fallback

// Ghi `VITE_API_URL` vào frontend/.env để frontend dev server biết backend đang chạy ở cổng nào.
const updateFrontendEnv = (port) => {
  try {
    const frontendEnvPath = path.join(__dirname, "..", "frontend", ".env");
    const line = `VITE_API_URL=http://localhost:${port}/api`;

    let content = "";
    if (fs.existsSync(frontendEnvPath)) {
      content = fs.readFileSync(frontendEnvPath, "utf8");
      if (/^VITE_API_URL=.*$/m.test(content)) {
        content = content.replace(/^VITE_API_URL=.*$/m, line);
      } else {
        if (content.length && !content.endsWith("\n")) content += "\n";
        content += line + "\n";
      }
    } else {
      // tạo file nếu chưa có
      content = line + "\n";
    }

    fs.writeFileSync(frontendEnvPath, content, "utf8");
    console.log(`Updated frontend .env -> ${line}`);
  } catch (e) {
    console.warn("Unable to update frontend .env:", e.message);
  }
};

const startServer = async (port, retries = 10) => {
  const p = Number(port);
  const httpServer = http.createServer(app);
  await initSocket(httpServer);

  // Only run cron jobs on a single worker (PM2 instance 0) to avoid N× firing in cluster mode.
  // NODE_APP_INSTANCE is undefined when running outside PM2 (dev / single process).
  const instance = process.env.NODE_APP_INSTANCE;
  const shouldRunCrons = instance === undefined || instance === "0";

  app.locals.port = p;

  const server = httpServer.listen(p, () => {
    if (shouldRunCrons) {
      startCrons();
      startCDC().catch(e => console.error('[app] Failed to start CDC:', e.message));
    } else {
      console.log(`[cron] skipped on worker instance ${instance}`);
    }
    console.log(`\n Aduu ERP Server đang chạy tại: http://localhost:${p}`);
    console.log(` Environment: ${process.env.NODE_ENV || "development"}`);
    console.log("\n API Endpoints:");
    console.log(`  POST   /api/auth/login`);
    console.log(`  GET    /api/auth/me`);
    console.log(`  GET    /api/products`);
    console.log(`  POST   /api/orders`);
    console.log(`  GET    /api/dashboard/overview`);
    console.log(`  POST   /api/inventory/import`);
    console.log(`  GET    /api/inventory/transactions`);
    console.log(`  GET    /api/customers`);
    console.log(`  GET    /api/hr/employees`);
    console.log(`  POST   /api/hr/payrolls/generate`);
    console.log(`  GET    /api/analytics/sales-insights`);
    console.log(`  GET    /api-docs`);
    // Cập nhật frontend/.env để frontend dev biết API URL (chỉ cho môi trường dev)
    try {
      updateFrontendEnv(p);
    } catch (e) {
      // không block server nếu không thể ghi file
    }
  });

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.warn(`Port ${p} is already in use.`);
      if (retries > 0) {
        console.log(`Trying port ${p + 1}... (${retries - 1} retries left)`);
        startServer(p + 1, retries - 1);
      } else {
        console.error(
          "No available ports found. Please free the port or set PORT in .env.",
        );
        process.exit(1);
      }
    } else {
      console.error("Server error:", err);
      process.exit(1);
    }
  });
};

startServer(DEFAULT_PORT).catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

module.exports = app;
