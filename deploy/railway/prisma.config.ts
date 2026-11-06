import { defineConfig } from "@prisma/config";

// Production migrations never use a development shadow database.
// This file is copied to /app/prisma.config.ts in the Railway image.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL },
});
