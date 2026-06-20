// src/modules/ai/ai.service.js
// RAG pipeline using Ollama (100% local AI)
//
// NOTE: Cac bang ai_documents va ai_embeddings duoc tao bang raw SQL migration
// (prisma/migrations/20260620100000_add_ai_vector_tables/migration.sql)
// va KHONG co trong Prisma schema. Moi truy van deu dung $queryRawUnsafe/$executeRawUnsafe.
const prisma = require("../../config/prisma");

// --------------- Ollama Config ---------------
const OLLAMA_BASE = process.env.OLLAMA_URL || "http://localhost:11434";
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "gemma2:9b";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const TOP_K = 8;
const SYNC_BATCH_SIZE = 20;

// --------------- Ollama helpers ---------------

/**
 * Goi Ollama chat API.
 */
const ollamaChat = async (messages, options = {}) => {
  const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model || CHAT_MODEL,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.3,
        num_predict: options.maxTokens ?? 1024,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama chat error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.message?.content?.trim() || "";
};

/**
 * Tao embedding vector bang Ollama.
 * Model nomic-embed-text output 768 dimensions.
 */
const createEmbedding = async (text) => {
  const response = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama embed error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  // Ollama /api/embed tra ve { embeddings: [[...]] }
  return data.embeddings?.[0] || data.embedding || [];
};

/**
 * Kiem tra Ollama co dang chay khong.
 */
const checkOllamaHealth = async () => {
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { status: "error", message: `HTTP ${response.status}` };
    const data = await response.json();
    const models = (data.models || []).map((m) => m.name);
    return { status: "ok", url: OLLAMA_BASE, models };
  } catch (e) {
    return { status: "error", message: e.message, url: OLLAMA_BASE };
  }
};

// --------------- Vector DB helpers ---------------

/**
 * Upsert document + embedding vao pgvector.
 */
const upsertDocument = async (entityType, entityId, content, metadata = {}) => {
  const embedding = await createEmbedding(content);
  const vectorStr = `[${embedding.join(",")}]`;

  await prisma.$executeRawUnsafe(
    `INSERT INTO ai_documents (id, entity_type, entity_id, content, metadata, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (entity_type, entity_id)
     DO UPDATE SET content = $3, metadata = $4::jsonb, updated_at = NOW()`,
    entityType,
    entityId,
    content,
    JSON.stringify(metadata),
  );

  const [doc] = await prisma.$queryRawUnsafe(
    `SELECT id FROM ai_documents WHERE entity_type = $1 AND entity_id = $2`,
    entityType,
    entityId,
  );

  if (!doc) return;

  await prisma.$executeRawUnsafe(
    `INSERT INTO ai_embeddings (id, document_id, embedding, updated_at)
     VALUES (gen_random_uuid(), $1, $2::vector, NOW())
     ON CONFLICT (document_id)
     DO UPDATE SET embedding = $2::vector, updated_at = NOW()`,
    doc.id,
    vectorStr,
  );
};

/**
 * Vector similarity search: tim top-K documents gan nhat voi query.
 * entityTypes duoc truyen qua parameterized query de tranh SQL injection.
 */
const searchDocuments = async (queryText, topK = TOP_K, entityTypes = null) => {
  const queryEmbedding = await createEmbedding(queryText);
  const vectorStr = `[${queryEmbedding.join(",")}]`;

  // Neu co filter entityTypes, dung ANY($3::text[]) de parameterize
  if (entityTypes && entityTypes.length > 0) {
    const results = await prisma.$queryRawUnsafe(
      `SELECT d.id, d.entity_type, d.entity_id, d.content, d.metadata,
              1 - (e.embedding <=> $1::vector) AS similarity
       FROM ai_embeddings e
       JOIN ai_documents d ON d.id = e.document_id
       WHERE d.entity_type = ANY($3::text[])
       ORDER BY e.embedding <=> $1::vector
       LIMIT $2`,
      vectorStr,
      topK,
      entityTypes,
    );
    return results;
  }

  const results = await prisma.$queryRawUnsafe(
    `SELECT d.id, d.entity_type, d.entity_id, d.content, d.metadata,
            1 - (e.embedding <=> $1::vector) AS similarity
     FROM ai_embeddings e
     JOIN ai_documents d ON d.id = e.document_id
     ORDER BY e.embedding <=> $1::vector
     LIMIT $2`,
    vectorStr,
    topK,
  );

  return results;
};

// --------------- Data Sync (batched) ---------------

/**
 * Xu ly batch: chia array thanh cac nhom nho va xu ly tuan tu.
 */
const processBatch = async (items, batchSize, processFn, label) => {
  let processed = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(processFn));
    processed += batch.length;
    if (items.length > batchSize) {
      console.log(`[ai:sync] ${label}: ${processed}/${items.length}`);
    }
  }
  return processed;
};

const syncERPData = async () => {
  const stats = { products: 0, customers: 0, knowledge: 0 };
  const startTime = Date.now();
  console.log("[ai:sync] Bat dau dong bo du lieu ERP...");

  // Sync products
  const products = await prisma.product.findMany({
    where: { isActive: true },
    include: { category: true },
    take: 500,
  });

  stats.products = await processBatch(products, SYNC_BATCH_SIZE, async (p) => {
    const content = [
      `San pham: ${p.name}`,
      `SKU: ${p.sku}`,
      `Danh muc: ${p.category?.name || "Chua phan loai"}`,
      `Gia ban: ${p.price} VND`,
      `Gia von: ${p.costPrice} VND`,
      `Don vi: ${p.unit}`,
      p.description ? `Mo ta: ${p.description}` : "",
    ].filter(Boolean).join(". ");

    await upsertDocument("product", p.id, content, {
      sku: p.sku,
      price: Number(p.price),
      categoryId: p.categoryId,
    });
  }, "products");

  // Sync customers (top 200 by totalSpent)
  const customers = await prisma.customer.findMany({
    where: { isActive: true },
    orderBy: { totalSpent: "desc" },
    take: 200,
  });

  stats.customers = await processBatch(customers, SYNC_BATCH_SIZE, async (c) => {
    const content = [
      `Khach hang: ${c.name}`,
      c.phone ? `SDT: ${c.phone}` : "",
      c.email ? `Email: ${c.email}` : "",
      `Hang: ${c.tier}`,
      `Tong chi tieu: ${c.totalSpent} VND`,
      `Cong no: ${c.totalDebt} VND`,
      `Diem tich luy: ${c.loyaltyPoints}`,
    ].filter(Boolean).join(". ");

    await upsertDocument("customer", c.id, content, {
      tier: c.tier,
      totalSpent: Number(c.totalSpent),
    });
  }, "customers");

  // Sync knowledge base
  const knowledgeDocs = [
    {
      id: "vas-accounting",
      content: "He thong ke toan Aduu tuan theo Chuan muc Ke toan Viet Nam (VAS). He thong tai khoan bao gom: TK 111 (Tien mat), TK 112 (Tien gui ngan hang), TK 131 (Phai thu khach hang), TK 156 (Hang hoa), TK 331 (Phai tra nguoi ban), TK 511 (Doanh thu), TK 632 (Gia von hang ban), TK 641 (Chi phi ban hang), TK 642 (Chi phi quan ly). Moi giao dich tao but toan kep (double-entry) tu dong.",
    },
    {
      id: "inventory-rules",
      content: "Quan ly ton kho: Ho tro da kho (multi-warehouse), chuyen kho (stock transfer), kiem ke (cycle count). Theo doi lo hang (lot tracking) voi ngay san xuat va han su dung. Canh bao ton kho thap khi quantity <= minStock. Ho tro reservation (dat truoc hang cho don hang).",
    },
    {
      id: "order-flow",
      content: "Quy trinh don hang: PENDING -> CONFIRMED -> SHIPPING -> COMPLETED hoac CANCELLED. Thanh toan ho tro: tien mat, chuyen khoan, the. Trang thai thanh toan: UNPAID, PARTIAL, PAID. Ho tro tra hang (return) voi hoan tien hoac doi hang. Tu dong tao but toan ke toan khi hoan thanh don.",
    },
    {
      id: "hr-payroll",
      content: "Quan ly nhan su: Cham cong theo ca (sang/chieu/toi), tinh luong tu dong theo he so cham cong. Tru vi pham (di muon, ve som, loi dong goi). Tinh BHXH, thue TNCN theo quy dinh. Luong = (Luong co ban x He so) + Phu cap ca - Vi pham - BHXH - Thue TNCN.",
    },
    {
      id: "crm-features",
      content: "CRM: Phan hang khach hang (Bronze/Silver/Gold/Platinum). Tich diem loyalty theo don hang. Ghi chu khach hang (goi dien, email, gap mat, Zalo). Gan tag phan loai. Phan khuc khach hang (segment) theo rules. Chien dich marketing qua Email va Zalo OA.",
    },
  ];

  for (const doc of knowledgeDocs) {
    await upsertDocument("knowledge", doc.id, doc.content, {});
    stats.knowledge++;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[ai:sync] Hoan tat trong ${elapsed}s: ${stats.products} products, ${stats.customers} customers, ${stats.knowledge} knowledge docs`);

  return stats;
};

// --------------- Chat (RAG) ---------------

const SYSTEM_PROMPT = `Ban la tro ly AI cua he thong ERP Aduu — he thong quan tri doanh nghiep ban le Viet Nam.
Nhiem vu: Tra loi cau hoi ve doanh thu, san pham, khach hang, ton kho, ke toan, nhan su dua tren du lieu thuc cua doanh nghiep.

Quy tac:
- Tra loi bang tieng Viet, ngan gon, chinh xac.
- Neu co du lieu context, hay dua vao do de tra loi.
- Neu khong co du du lieu, noi ro va goi y cach tim thong tin.
- Khong bia so lieu. Neu khong biet, noi "Toi chua co du lieu nay".
- Co the goi y hanh dong: "Ban co the vao trang Bao cao de xem chi tiet".
- Format tien te theo VND (dung dau cham phan cach hang nghin).`;

const chat = async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Vui long nhap cau hoi" });
    }

    // 1. Vector search
    let contextDocs = [];
    try {
      contextDocs = await searchDocuments(message, TOP_K);
    } catch (e) {
      console.warn("[ai] vector search failed (pgvector not ready?):", e.message);
    }

    // 2. Real-time stats
    const [orderStats, inventoryAlerts] = await Promise.all([
      getQuickOrderStats(),
      getInventoryAlerts(),
    ]);

    // 3. Assemble context
    const contextParts = [];

    if (contextDocs.length > 0) {
      contextParts.push(
        "=== DU LIEU LIEN QUAN ===",
        ...contextDocs.map((d, i) => `[${i + 1}] (${d.entity_type}) ${d.content}`),
      );
    }

    if (orderStats) {
      contextParts.push(
        "\n=== THONG KE NHANH ===",
        `Don hang hom nay: ${orderStats.todayCount} don, doanh thu: ${orderStats.todayRevenue} VND`,
        `Don cho xu ly: ${orderStats.pendingCount}`,
      );
    }

    if (inventoryAlerts.length > 0) {
      contextParts.push(
        "\n=== CANH BAO TON KHO ===",
        ...inventoryAlerts.map((a) => `${a.productName}: con ${a.quantity} (min: ${a.minStock})`),
      );
    }

    const contextStr = contextParts.join("\n");

    // 4. Build messages for Ollama
    const ollamaMessages = [{ role: "system", content: SYSTEM_PROMPT }];

    const recentHistory = history.slice(-10);
    for (const h of recentHistory) {
      if (h.role === "user" || h.role === "assistant") {
        ollamaMessages.push({ role: h.role, content: h.content });
      }
    }

    const userMessage = contextStr
      ? `${contextStr}\n\n--- CAU HOI ---\n${message}`
      : message;

    ollamaMessages.push({ role: "user", content: userMessage });

    // 5. Call Ollama
    const reply = await ollamaChat(ollamaMessages);

    res.json({
      success: true,
      reply: reply || "Xin loi, toi khong the tra loi luc nay.",
      model: CHAT_MODEL,
      sources: contextDocs.map((d) => ({
        type: d.entity_type,
        id: d.entity_id,
        similarity: d.similarity ? Number(d.similarity).toFixed(3) : null,
      })),
    });
  } catch (error) {
    console.error("[ai] chat error:", error);

    let errorMsg = "Loi xu ly AI";
    if (error.cause?.code === "ECONNREFUSED" || error.message?.includes("ECONNREFUSED")) {
      errorMsg = `Khong the ket noi Ollama tai ${OLLAMA_BASE}. Vui long kiem tra Ollama da chay chua (ollama serve).`;
    } else if (error.message?.includes("model")) {
      errorMsg = `Model '${CHAT_MODEL}' chua duoc tai. Chay: ollama pull ${CHAT_MODEL}`;
    }

    res.status(500).json({ success: false, message: errorMsg });
  }
};

const triggerSync = async (req, res) => {
  try {
    const stats = await syncERPData();
    res.json({ success: true, message: "Dong bo du lieu AI thanh cong", stats });
  } catch (error) {
    console.error("[ai] sync error:", error);

    let errorMsg = "Loi dong bo du lieu AI";
    if (error.message?.includes("ECONNREFUSED")) {
      errorMsg = `Khong the ket noi Ollama tai ${OLLAMA_BASE}. Can Ollama de tao embeddings. Chay: ollama serve && ollama pull ${EMBED_MODEL}`;
    }

    res.status(500).json({ success: false, message: errorMsg });
  }
};

// getSuggestions: Chi query DB, khong can Ollama.
const getSuggestions = async (req, res) => {
  try {
    const suggestions = [];

    // Low stock
    const lowStockItems = await prisma.$queryRawUnsafe(
      `SELECT i.quantity, i."minStock", p.name as "productName", p.sku
       FROM inventories i JOIN products p ON p.id = i."productId"
       WHERE i.quantity <= i."minStock" AND p."isActive" = true
       ORDER BY i.quantity ASC LIMIT 5`
    ).catch(() => []);

    if (lowStockItems.length > 0) {
      suggestions.push({
        type: "warning",
        title: "San pham sap het hang",
        message: `Co ${lowStockItems.length} san pham can nhap them hang`,
        action: { label: "Xem ton kho", path: "/inventory" },
      });
    }

    // Pending orders > 24h
    const pendingOrders = await prisma.order.count({
      where: {
        status: "PENDING",
        createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }).catch(() => 0);

    if (pendingOrders > 0) {
      suggestions.push({
        type: "info",
        title: "Don hang cho xu ly",
        message: `${pendingOrders} don hang da cho hon 24 gio`,
        action: { label: "Xem don hang", path: "/orders" },
      });
    }

    // Overdue debts
    const overdueDebts = await prisma.debt.count({
      where: {
        status: { in: ["OPEN", "PARTIAL"] },
        dueDate: { lt: new Date() },
      },
    }).catch(() => 0);

    if (overdueDebts > 0) {
      suggestions.push({
        type: "critical",
        title: "Cong no qua han",
        message: `${overdueDebts} khoan cong no da qua han thanh toan`,
        action: { label: "Xem cong no", path: "/debts" },
      });
    }

    res.json({ success: true, suggestions });
  } catch (error) {
    console.error("[ai] suggestions error:", error);
    res.status(500).json({ success: false, message: "Loi lay goi y" });
  }
};

// --------------- Helper queries ---------------

const getQuickOrderStats = async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayOrders, pendingCount] = await Promise.all([
      prisma.order.aggregate({
        where: { createdAt: { gte: today }, status: { not: "CANCELLED" } },
        _count: true,
        _sum: { total: true },
      }),
      prisma.order.count({ where: { status: "PENDING" } }),
    ]);

    return {
      todayCount: todayOrders._count || 0,
      todayRevenue: todayOrders._sum?.total || 0,
      pendingCount,
    };
  } catch {
    return null;
  }
};

const getInventoryAlerts = async () => {
  try {
    const alerts = await prisma.$queryRawUnsafe(
      `SELECT p.name as "productName", i.quantity, i."minStock"
       FROM inventories i JOIN products p ON p.id = i."productId"
       WHERE i.quantity <= i."minStock" AND p."isActive" = true
       ORDER BY i.quantity ASC LIMIT 5`
    );
    return alerts || [];
  } catch {
    return [];
  }
};

module.exports = {
  chat,
  triggerSync,
  getSuggestions,
  syncERPData,
  upsertDocument,
  searchDocuments,
  createEmbedding,
  checkOllamaHealth,
};
