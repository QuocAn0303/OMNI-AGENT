const { z } = require("zod");

const createDocumentSchema = z.object({
  title: z.string().min(1, "Tiêu đề không được để trống"),
  description: z.string().optional(),
  sendToAll: z
    .union([z.boolean(), z.string().transform((v) => v === "true")])
    .default(false),
  departmentIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (!v) return [];
      if (Array.isArray(v)) return v;
      return [v];
    }),
});

module.exports = { createDocumentSchema };
