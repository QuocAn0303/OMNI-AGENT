const Redis = require("ioredis");

const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const makeClient = (role) =>
  new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  }).on("error", (err) => {
    console.error(`[redis:${role}]`, err.message);
  });

const redis = makeClient("main");
const pubClient = makeClient("pub");
const subClient = pubClient.duplicate();

module.exports = { redis, pubClient, subClient };
