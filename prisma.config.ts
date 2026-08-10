import { defineConfig } from "@prisma/config";
import "dotenv/config";

export default defineConfig({
  migrations: {
    seed: "node prisma/seed.js",
  },
  earlyAccess: true,
  datasource: {
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || `${process.env.DATABASE_URL?.replace('erp_db', 'erp_shadow')}`,
  },
});
