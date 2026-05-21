require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const prods = await prisma.product.findMany({
    take: 20,
    orderBy: { createdAt: "desc" },
  });
  console.log("Sample products (name | price | costPrice):");
  for (const p of prods) {
    console.log(
      `${p.name} | ${p.price.toString()} | ${p.costPrice.toString()}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
