const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const url = new URL(process.env.DATABASE_URL || require('fs').readFileSync('.env','utf8').match(/DATABASE_URL="?([^"\r\n]+)"?/)[1]);
const pool = new Pool({ host:url.hostname, port:+(url.port||5432), database:url.pathname.slice(1), user:decodeURIComponent(url.username), password:decodeURIComponent(url.password) });
const p = new PrismaClient({ adapter: new PrismaPg(pool) });
(async()=>{
  const users = await p.user.findMany({ where:{ email:{ in:['admin@candory.com','superadmin@candory.com','manager@candory.com'] } }, select:{id:true,email:true,role:true,tenantId:true,department:true} });
  console.log(JSON.stringify(users,null,2));
  const wh = await p.warehouse.findMany({ take:3, select:{id:true,code:true,name:true,tenantId:true} });
  console.log(JSON.stringify(wh,null,2));
  const v = await p.vendor.findMany({ take:2, select:{id:true,code:true,name:true,taxCode:true,tenantId:true} });
  console.log(JSON.stringify(v,null,2));
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1)});
