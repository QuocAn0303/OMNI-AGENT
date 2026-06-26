/**
 * config/swagger.js — Cấu hình Swagger/OpenAPI cho API docs
 * 
 * Tổng quan:
 * - Dùng swagger-jsdoc để đọc JSDoc comments từ các file routes
 * - Định nghĩa OpenAPI 3.0.0 spec: title, version, servers, security scheme (bearer JWT)
 * - Định nghĩa sẵn 2 schema mẫu: Product, InventoryAction
 * - Chỉ mount ở dev (NODE_ENV !== "production") — xem app.js
 * - Quét tất cả file *.routes.js trong src/modules/ để lấy comment
 */

const swaggerJSDoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Aduu ERP — Hệ thống hoạch định nguồn lực doanh nghiệp v.2.0",
      version: "2.0.0",
      description: "API documentation cho Aduu ERP",
    },
    servers: [
      {
        url: process.env.SWAGGER_SERVER_URL || "http://localhost:3000",
        description: "Local Server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        Product: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            sku: { type: "string" },
            name: { type: "string" },
            price: { type: "number" },
            costPrice: { type: "number" },
            categoryId: { type: "string", format: "uuid" },
          },
        },
        InventoryAction: {
          type: "object",
          properties: {
            productId: { type: "string", format: "uuid" },
            quantity: { type: "integer" },
            note: { type: "string" },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  // Đường dẫn trỏ tới các file routes chứa comment JSDoc
  apis: ["./src/modules/**/*.routes.js"],
};

module.exports = swaggerJSDoc(options);
