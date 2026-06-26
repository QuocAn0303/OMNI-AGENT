const crypto = require("crypto");

const BASE = "https://partner.shopeemobile.com";

function sign(partnerId, partnerKey, accessToken, shopId, timestamp) {
  const raw = `${partnerId}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", partnerKey).update(raw).digest("hex");
}

async function api(path, body, creds) {
  const timestamp = Math.floor(Date.now() / 1000);
  const { partnerId, partnerKey, accessToken, shopId } = creds;
  const signature = sign(partnerId, partnerKey, accessToken, shopId, timestamp);

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopee-Sign": signature,
      "X-Shopee-Timestamp": String(timestamp),
      "X-Shopee-Partner-Id": String(partnerId),
      "X-Shopee-Access-Token": accessToken,
      "X-Shopee-Shop-Id": String(shopId),
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(`Shopee API ${path}: ${json.error} — ${json.message || ""}`);
  }
  return json;
}

async function pushInventory(creds, listings) {
  const results = [];
  for (const listing of listings) {
    try {
      const stock = listing.product.inventories.reduce((s, i) => s + i.quantity, 0);
      const body = {
        shop_id: Number(creds.shopId),
        item_id: Number(listing.externalId),
        stock_list: [{ model_id: 0, seller_stock: [{ stock, location_id: "" }] }],
      };
      await api("/api/v2/product/update_stock", body, creds);
      results.push({ listingId: listing.id, status: "ok", stock });
    } catch (e) {
      results.push({ listingId: listing.id, status: "error", error: e.message });
    }
  }
  return results;
}

async function pullOrders(creds, lastSyncAt) {
  const timestamp = Math.floor(Date.now() / 1000);
  const timeFrom = lastSyncAt ? Math.floor(new Date(lastSyncAt).getTime() / 1000) : timestamp - 86400 * 7;

  const body = {
    shop_id: Number(creds.shopId),
    time_range_field: "create_time",
    time_from: timeFrom,
    time_to: timestamp,
    page_size: 100,
  };

  const data = await api("/api/v2/order/get_order_list", body, creds);
  return data.response?.order_list?.map((o) => ({
    externalId: String(o.order_sn),
    orderStatus: o.order_status,
    totalAmount: o.total_amount,
    currency: o.currency,
    items: (o.item_list || []).map((i) => ({
      externalId: String(i.item_id),
      sku: i.item_sku,
      name: i.item_name,
      quantity: i.model_quantity_purchased,
    })),
    customerName: o.recipient_address?.name,
    customerPhone: o.recipient_address?.phone,
    shippingAddress: o.recipient_address?.full_address,
    orderPlacedAt: new Date(o.create_time * 1000).toISOString(),
  })) || [];
}

module.exports = { pushInventory, pullOrders };
