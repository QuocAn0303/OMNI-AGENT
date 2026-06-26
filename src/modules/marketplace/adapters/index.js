const shopee = require("./shopee.adapter");
const tiktok = require("./tiktok.adapter");

const ADAPTERS = { SHOPEE: shopee, TIKTOK: tiktok };

function getAdapter(platform) {
  const a = ADAPTERS[platform];
  if (!a) throw new Error(`Unsupported platform: ${platform}`);
  return a;
}

async function pushInventory(platform, creds, listings) {
  return getAdapter(platform).pushInventory(creds, listings);
}

async function pullOrders(platform, creds, lastSyncAt) {
  return getAdapter(platform).pullOrders(creds, lastSyncAt);
}

module.exports = { pushInventory, pullOrders };
