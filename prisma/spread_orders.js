// prisma/spread_orders.js
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const rndInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgoDate = (days) => {
  const now = new Date();
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  // randomize time of day
  d.setHours(rndInt(0, 23), rndInt(0, 59), rndInt(0, 59), 0);
  return d;
};

(async function main() {
  try {
    console.log("→ Spreading orders over last 60 days...");
    const orders = await prisma.order.findMany({ where: { total: { gt: 0 } } });
    console.log(`Found ${orders.length} orders with total>0`);

    let updated = 0;
    for (const ord of orders) {
      // randomly assign statuses
      const r = Math.random();
      let newStatus = "COMPLETED";
      if (r < 0.15) newStatus = "PENDING";
      else if (r < 0.3) newStatus = "CONFIRMED";
      else if (r < 0.45) newStatus = "SHIPPING";
      else if (r < 0.55) newStatus = "CANCELLED";
      else newStatus = "COMPLETED";

      // bias createdAt distribution: 50% last 7 days, 30% 8-30 days, 20% 31-60 days
      const rr = Math.random();
      let days;
      if (rr < 0.5) days = rndInt(0, 6);
      else if (rr < 0.8) days = rndInt(7, 30);
      else days = rndInt(31, 60);

      const newDate = daysAgoDate(days);

      await prisma.order.update({
        where: { id: ord.id },
        data: {
          status: newStatus,
          createdAt: newDate,
          updatedAt: new Date(),
        },
      });
      updated++;
    }

    console.log(
      `Updated ${updated} orders with mixed statuses and distributed createdAt`,
    );
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
    try {
      await pool.end();
    } catch (err) {
      // ignore
    }
    process.exit(0);
  }
})();
