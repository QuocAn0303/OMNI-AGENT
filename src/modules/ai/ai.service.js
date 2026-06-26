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
      content: "He thong ke toan Aduu tuan theo Chuan muc Ke toan Viet Nam (VAS) va Thong tu 200. He thong tai khoan 33+ TK gom: 111 (Tien mat), 112 (TGNH), 131 (Phai thu KH), 133 (Thue GTGT duoc khau tru), 138 (Phai thu khac), 141 (Tam ung), 154 (Chi phi SXDD), 155 (Thanh pham), 156 (Hang hoa), 211 (TSCD), 214 (Hao mon TSCD), 242 (CP tra truoc), 331 (Phai tra NB), 333 (Thue phai nop), 334 (Phai tra NV), 338 (Phai tra khac), 341 (Vay), 411 (Von CSH), 421 (LN chua PP), 511 (Doanh thu), 515 (DT tai chinh), 521 (Giam tru DT), 632 (GVHB), 635 (CP tai chinh), 641 (CP ban hang), 642 (CP quan ly), 711 (Thu nhap khac), 811 (Chi phi khac), 821 (CP thue TNDN), 911 (Xac dinh KQKD). Moi giao dich tu dong tao but toan kep (double-entry) voi nguyen tac No bang Co.",
    },
    {
      id: "accounting-period-close",
      content: "Ket chuyen cuoi ky (period-close): Cuoi moi thang, he thong tu dong ket chuyen: (1) Doanh thu 511/515/711 → No 511/515/711, Co 911. (2) Chi phi 632/635/641/642/811/821 → No 911, Co 632/635/641/642/811/821. (3) Xac dinh KQKD: Neu Co 911 > No 911 → lai (No 911/Co 421). Neu No 911 > Co 911 → lo (No 421/Co 911). Co cron chay ngay dau thang de phan bo CP tra truoc (No 642/Co 242) va khau hao TSCD (No 642/Co 214).",
    },
    {
      id: "accounting-reports",
      content: "Bao cao tai chinh theo TT200: (1) B01-DN Bang can doi ke toan: Tai san ngan han + Tai san dai han = No phai tra + Von chu so huu. (2) B02-DN Bao cao KQKD gom 16 dong: Doanh thu thuan, GVHB, Loi nhuan gop, DT tai chinh, CP tai chinh, CP ban hang, CP quan ly, LN thuan HDSXKD, Thu nhap khac, Chi phi khac, LN khac, Tong LN truoc thue, CP thue TNDN, LN sau thue. (3) B03-DN Bao cao luu chuyen tien te phan loai theo hoat dong kinh doanh/dau tu/tai chinh. (4) Bang can doi so phat sinh 6 cot: Du dau ky No/Co, Phat sinh No/Co, Du cuoi ky No/Co.",
    },
    {
      id: "accounting-tax",
      content: "Thue GTGT: Thue dau ra (TK 3331) - Thue dau vao duoc khau tru (TK 1331) = Thue phai nop. VAT rates: 0%, 5%, 8%, 10%. Thue TNDN: Loi nhuan ke toan truoc thue x 20% = Thue TNDN tam tinh quy. But toan: No 821/Co 3334. Moi quy tinh 1 lan vao cuoi quy. Bao cao thue HTKK ho tro xuat XML va Excel dung dinh dang nop thue online.",
    },
    {
      id: "accounting-costing",
      content: "Tinh gia von hang ban (COGS): Su dung phuong phap binh quan gia quyen (weighted average cost). Khi nhap hang: costPrice = (tonCu x giaCu + nhap x giaMoi) / (tonCu + nhap). Khi xuat hang: tu dong tinh COGS dua tren costPrice hien tai. Dinh gia ton kho cuoi ky: so luong ton x costPrice hien tai. He thong theo doi costPrice tren tung san pham.",
    },
    {
      id: "accounting-prepaid",
      content: "Phan bo chi phi tra truoc (TK 242): Khi tra tien cho dich vu keo dai nhieu thang (thue van phong, bao hiem, phan mem): No 242/Co 112. Hang thang phan bo: No 642/Co 242 cho den khi het. Moi thang phan bo mot phan bang nhau: so tien / so thang. Cron tu dong phan bo vao ngay 1 hang thang.",
    },
    {
      id: "accounting-fixed-assets",
      content: "Khau hao TSCD: Phuong phap duong thang (straight-line). Moi TSCD co thoi gian su dung (thang). Khau hao hang thang = Nguyen gia / So thang su dung. But toan hang thang: No 642/Co 214 (Hao mon TSCD). Khi mua TSCD: No 211/Co 112. Khi thanh ly: ghi giam nguyen gia (Co 211) va hao mon luy ke (No 214), phan chenh lech dua vao thu nhap khac (No 711) hoac chi phi khac (Co 811). Cron tu dong khau hao vao ngay 1 hang thang.",
    },
    {
      id: "inventory-rules",
      content: "Quan ly ton kho: Ho tro da kho (multi-warehouse), chuyen kho (stock transfer), kiem ke (cycle count). Theo doi lo hang (lot tracking) voi ngay san xuat va han su dung. Canh bao ton kho thap khi quantity <= minStock. Ho tro reservation (dat truoc hang cho don hang). Giao dich kho: IMPORT, EXPORT, ADJUSTMENT, RETURN. Moi giao dich deu ghi nhan vao InventoryTransaction va tu dong tao but toan ke toan.",
    },
    {
      id: "order-flow",
      content: "Quy trinh don hang: PENDING -> CONFIRMED -> SHIPPING -> COMPLETED hoac CANCELLED. Thanh toan ho tro: CASH, BANK_TRANSFER, CARD. Trang thai thanh toan: UNPAID, PARTIAL, PAID. Ho tro tra hang (return) voi hoan tien hoac doi hang. Khi don COMPLETED: tu dong phat hanh hoa don dien tu (VNPT), sinh PDF invoice, kiem tra ton kho thap de tao PO tu dong.",
    },
    {
      id: "automation-workflow",
      content: "Automation: (1) Auto-reorder: khi ton kho <= minStock, tu dong tao Purchase Order cho vendor mac dinh. Neu PO < 5 trieu VND → auto-approve. (2) Auto-payroll: ngay 25 hang thang tu dong tinh luong va tao but toan ke toan (No 642/Co 334/338/333). (3) Debt collection: 3 cap nhac no tu dong — sap den han 3 ngay (notify MANAGER), qua han 7 ngay (escalate ADMIN), qua han 30 ngay (flag xu ly dac biet). (4) Invoice PDF: tu dong sinh PDF khi don COMPLETED. (5) Bank reco: tu dong doi soat sao ke moi ngay.",
    },
    {
      id: "workflow-engine",
      content: "Workflow/Approval engine: 4 triggers — EXPENSE_ABOVE (chi phi > nguong), PO_ABOVE (don nhap > nguong), LEAVE_REQUEST (xin nghi phep), CUSTOM. Moi workflow co nhieu buoc duyet (APPROVAL/NOTIFICATION), nguoi duyet duoc phan cong theo step. Khi tat ca cac buoc duyet APPROVED, he thong tu dong approve entity goc (expense/PO/leave). Ho tro frontend Approvals dashboard de xem pending va lich su runs.",
    },
    {
      id: "hr-payroll",
      content: "Quan ly nhan su: Cham cong theo ca (sang/chieu/toi), tinh luong tu dong theo he so cham cong. Tru vi pham (di muon, ve som, loi dong goi). Tinh BHXH (8% NV + 17.5% DN), BHYT (1.5%), BHTN (1%). TNCN theo bieu luy tien 7 bac. Cong thuc: Luong = (Luong co ban x He so) + Phu cap ca - Vi pham - BHXH - Thue TNCN. Ho tro xin nghi phep qua workflow: POST /api/hr/leave → trigger LEAVE_REQUEST → manager duyet → tu dong update shift.",
    },
    {
      id: "crm-features",
      content: "CRM: Phan hang khach hang (Bronze/Silver/Gold/Platinum) dua tren tong chi tieu. Tich diem loyalty: moi 1000 VND = 1 diem. Doi diem lay uu dai: 100 diem = giam 10,000 VND, 500 diem = giam 50,000 VND, 1000 diem = giam 100,000 VND. Ghi chu khach hang (goi dien, email, gap mat, Zalo). Gan tag phan loai. Phan khuc khach hang (segment) theo rules. Chien dich marketing qua Email va Zalo OA.",
    },
    {
      id: "vietqr-payment",
      content: "VietQR Payment: Ho tro webhook tu Casso va SePay de tu dong xac nhan chuyen khoan ngan hang. Khi co giao dich chuyen tien, he thong tu dong match voi don hang (theo ma ORD- hoac amount) hoac cong no (theo ma DEBT-). Sau do tu dong ghi nhan thanh toan hoac cap nhat trang thai cong no. PayOS cung duoc ho tro qua verifyWebhook. Portal khach hang co endpoint GET /api/portal/debt/pay de sinh QR thanh toan cong no.",
    },
    {
      id: "portal-self-service",
      content: "Portal khach hang: khach hang dang nhap bang OTP qua SMS. Sau khi dang nhap co the: (1) Xem lich su don hang, hoa don dien tu. (2) Xem cong no va QR thanh toan. (3) Dat hang moi qua portal (B2B). (4) Xem diem loyalty va doi thuong. (5) Xem thong tin ca nhan. Portal dung x-portal-token thay vi JWT.",
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

const SYSTEM_PROMPT = `Ban la tro ly AI chuyen mon cua Aduu ERP — he thong quan tri doanh nghiep cho SME Viet Nam.
Kien thuc chuyen sau: Ke toan VAS/TT200 (B01-DN, B02-DN 16 dong, so cai, CDSPS 6 cot), thue GTGT/TNDN/TNCN, ton kho binh quan gia quyen, workflow duyet, auto-reorder, payroll, CRM loyalty.

Quy tac:
- Tra loi bang tieng Viet, ngan gon, chinh xac, co the dung markdown.
- Neu co context data, trich dan so lieu cu the.
- VOI CAU HOI KE TOAN: tra loi theo dung Chuan muc VAS va Thong tu 200, neu can dua cong thuc.
- VOI CAU HOI THUE: trich dan dung luat thue hien hanh, dua ra cach tinh.
- Neu khong co du lieu, noi ro va goi y API/trang ERP tuong ung.
- Khong bia so lieu. Neu khong biet, noi "Toi chua co du lieu nay".
- Format tien te VND, dung dau cham phan cach hang nghin.`;

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
