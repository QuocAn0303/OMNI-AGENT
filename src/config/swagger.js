const swaggerJSDoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "ERP Bán Lẻ API",
      version: "1.0.0",
      description: "API documentation cho đồ án Quản lý ERP Bán Lẻ",
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
