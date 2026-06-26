const BASE = "https://open-api.tiktokglobalshop.com";

async function api(path, body, creds) {
  const headers = {
    "Content-Type": "application/json",
    "x-tts-access-token": creds.accessToken,
  };

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, app_key: creds.appKey, shop_cipher: creds.shopCipher }),
  });

  const json = await res.json();
  if (json.code && json.code !== 0) {
    throw new Error(`TikTok API ${path}: ${json.code} — ${json.message || ""}`);
  }
  return json;
}

async function pushInventory(creds, listings) {
  const results = [];
  for (const listing of listings) {
    try {
      const stock = listing.product.inventories.reduce((s, i) => s + i.quantity, 0);
      const body = {
        product_id: listing.externalId,
        sku_stocks: [{ id: listing.externalSku || listing.externalId, quantity: stock }],
      };
      await api("/api/products/update_stocks", body, creds);
      results.push({ listingId: listing.id, status: "ok", stock });
    } catch (e) {
      results.push({ listingId: listing.id, status: "error", error: e.message });
    }
  }
  return results;
}

async function pullOrders(creds, lastSyncAt) {
  const now = new Date();
  const from = lastSyncAt ? new Date(lastSyncAt) : new Date(now.getTime() - 86400 * 7 * 1000);

  const body = {
    page_size: 100,
    create_time_gt: from.toISOString(),
    create_time_lt: now.toISOString(),
    sort_order: "DESC",
  };

  const data = await api("/api/orders/search", body, creds);
  return (data.data?.orders || []).map((o) => ({
    externalId: o.id,
    orderStatus: o.status,
    totalAmount: parseFloat(o.total_amount || "0"),
    currency: o.currency || "VND",
    items: (o.items || []).map((i) => ({
      externalId: i.product_id,
      sku: i.sku_id,
      name: i.product_name,
      quantity: i.quantity,
    })),
    customerName: o.buyer_user_name,
    customerPhone: o.buyer_phone,
    shippingAddress: o.shipping_address?.full_address,
    orderPlacedAt: o.create_time,
  })) || [];
}

module.exports = { pushInventory, pullOrders };
