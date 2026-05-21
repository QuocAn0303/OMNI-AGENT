const Redis = require("ioredis");

const url = process.env.REDIS_URL;

let redis = null;
let pubClient = null;
let subClient = null;

if (url) {
  const makeClient = (role) =>
    new Redis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
    }).on("error", (err) => {
      console.error(`[redis:${role}]`, err.message);
    });

  redis = makeClient("main");
  pubClient = makeClient("pub");
  subClient = pubClient.duplicate();
} else {
  console.log("[redis] REDIS_URL not set, running without Redis (in-memory mode)");
}

module.exports = { redis, pubClient, subClient };
