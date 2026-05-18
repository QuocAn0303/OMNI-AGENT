// src/app.js
require("dotenv").config();
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
//chưa hoạt động được
//const aiRoutes = require("./modules/ai/ai.routes");
const accountingRoutes = require("./modules/accounting/accounting.routes");
const debtRoutes = require("./modules/debt/debt.routes");
const notificationRoutes = require("./modules/notifications/notification.routes");
const purchaseOrderAliasRoutes = require("./modules/accounting/purchase-order.routes");
const promotionRoutes = require("./modules/promotions/promotion.routes");
const invoiceRoutes = require("./modules/orders/invoice.routes");
const loyaltyRoutes = require("./modules/loyalty/loyalty.routes");
const deliveryRoutes = require("./modules/delivery/delivery.routes");
const warehouseRoutes = require("./modules/warehouses/warehouse.routes");
const stockTransferRoutes = require("./modules/warehouses/stock-transfer.routes");
const deliveryService = require("./modules/delivery/delivery.service");
const http = require("http");
const { initSocket } = require("./realtime/socket");
const { startCrons } = require("./jobs/cron");

const app = express();
const corsOrigin =
  process.env.CORS_ORIGIN || process.env.CLIENT_URL || "http://localhost:5173";

// ==================== Middleware ====================
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(xssClean());
app.use(hpp());
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);
app.use(
  "/api/webhooks/delivery",
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

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ==================== Routes ====================
app.get("/", (req, res) => {
  res.json({ message: "ERP System API đang chạy", version: "1.0.0" });
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
//app.use("/api/ai", aiRoutes);
app.use("/api/accounting", accountingRoutes);
app.use("/api/debts", debtRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/purchase-orders", purchaseOrderAliasRoutes);
app.use("/api/promotions", promotionRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/loyalty", loyaltyRoutes);
app.use("/api/deliveries", deliveryRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/stock-transfers", stockTransferRoutes);

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

const startServer = (port, retries = 10) => {
  const p = Number(port);
  const httpServer = http.createServer(app);
  initSocket(httpServer);
  const server = httpServer.listen(p, () => {
    startCrons();
    console.log(`\n ERP Server đang chạy tại: http://localhost:${p}`);
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

startServer(DEFAULT_PORT);

module.exports = app;
