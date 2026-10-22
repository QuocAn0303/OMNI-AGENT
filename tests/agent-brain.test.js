/**
 * tests/agent-brain.test.js — hợp đồng của bộ não LLM (modules/ai/agent.brain)
 *
 * Bối cảnh (report 17/10/2026): agent chat khớp từ khoá nên hiểu sai câu có từ
 * đệm ("tạo cho mình đơn hàng"), nuốt chữ số trong tên sản phẩm ("Loại 1").
 * Brain thay bước đó bằng LLM-first tool calling. Test này khoá lại:
 *  - CẤU TRÚC đầu ra: {mode: tool|reply, tool, params, stepType} / null.
 *  - Lưới an toàn tiền: "5 triệu" KHÔNG BAO GIỜ thành 5 (regression của bug
 *    "giá 5 triệu bị âm thầm ghi thành giá rẻ").
 *  - DIỄM DỤ: mọi tên tool mà brain nhắc trong prompt đều TỒN TẠI ở route
 *    (TOOL_HANDLERS) hoặc DB (HANDLERS) — chống drift giữa prompt và code.
 *
 * isBrainEnabled phải false trong jest: tests/setup.js load .env thật nên
 * llm.isConfigured() là true — nếu brain chạy trong test sẽ gọi mạng âm thầm.
 */
jest.mock("../src/config/prisma", () => {
  const mockPrisma = {};
  // Đủ model agent.routes cần khi require — không chạy query nào ở đây.
  mockPrisma.order = { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), aggregate: jest.fn() };
  mockPrisma.customer = { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() };
  mockPrisma.inventory = { findMany: jest.fn() };
  mockPrisma.user = { findMany: jest.fn() };
  mockPrisma.agentSession = { create: jest.fn(), update: jest.fn() };
  mockPrisma.agentStep = { create: jest.fn() };
  mockPrisma.agentFeedback = { create: jest.fn(), groupBy: jest.fn() };
  mockPrisma.agentHumanGate = { create: jest.fn(), findMany: jest.fn() };
  return mockPrisma;
});
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), truncateLog: (v) => String(v),
}));
jest.mock("../src/modules/orders/order.service", () => ({ create: jest.fn() }));

const brain = require("../src/modules/ai/agent.brain");
const agentRoutes = require("../src/modules/ai/agent.routes");
const dbAgent = require("../src/modules/ai/db-agent.service");

describe("agent.brain — đầu ra quyết định", () => {
  test("tắt trong jest — pipeline từ khoá giữ tính xác định", () => {
    expect(process.env.JEST_WORKER_ID).toBeDefined();
    expect(brain.isBrainEnabled()).toBe(false);
  });

  test("reply mode: trả text + stepType LLM_CALL (dựa lỗi dấu/gõ sai)", () => {
    const d = brain.coerceDecision({ mode: "reply", text: "Chào bạn!" });
    expect(d).toEqual({ mode: "reply", text: "Chào bạn!", stepType: "LLM_CALL" });
  });

  test("reply mode: text rỗng → null (không trả lời trống)", () => {
    expect(brain.coerceDecision({ mode: "reply", text: "" })).toBeNull();
  });

  test("tool mode: tên chép theo schema DB (snake_case) được alias về camelCase", () => {
    expect(brain.coerceDecision({ tool: "create_order", params: {} }).tool).toBe("createOrder");
    expect(brain.coerceDecision({ tool: "create_po" }).tool).toBe("createPO");
    expect(brain.coerceDecision({ tool: "send_reminder" }).tool).toBe("sendReminder");
    expect(brain.coerceDecision({ tool: "get_dashboard" }).tool).toBe("viewDashboard");
  });

  test("tool mode: tool bịa (không nằm trong catalogue) → null", () => {
    expect(brain.coerceDecision({ mode: "tool", tool: "xoa_het_kho", params: {} })).toBeNull();
  });

  test("tool mode: params thiếu → {} (HANDLERS sẽ tự hỏi lại)", () => {
    const d = brain.coerceDecision({ tool: "createOrder" });
    expect(d.mode).toBe("tool");
    expect(d.params).toEqual({});
  });

  test("không mode không tool → null", () => {
    expect(brain.coerceDecision(null)).toBeNull();
    expect(brain.coerceDecision("chào")).toBeNull();
    expect(brain.coerceDecision({ hello: 1 })).toBeNull();
  });
});

describe("agent.brain — lưới an toàn tiền (regression)", () => {
  test("'5 triệu' → 5.000.000, KHÔNG phải 5 (bug thật 17/10/2026)", () => {
    const d = brain.coerceDecision({ tool: "createPO", params: { unitCost: "5 triệu", quantity: "3" } });
    expect(d.params.unitCost).toBe(5000000);
    expect(d.params.quantity).toBe(3);
  });

  test("'500k' → 500.000", () => {
    expect(brain.coerceDecision({ tool: "createPO", params: { unitCost: "500k" } }).params.unitCost).toBe(500000);
  });

  test("'5.550.000' → 5.550.000 (dấu chấm ngăn cách không nuốt digit)", () => {
    expect(brain.coerceDecision({ tool: "createPO", params: { unitCost: "5.550.000" } }).params.unitCost).toBe(5550000);
  });

  test("'giá 5' (đơn vị thiếu) bị BỎ — không tự chế giá", () => {
    const d = brain.coerceDecision({ tool: "createPO", params: { unitCost: "giá 5", productName: "Nến thơm" } });
    expect(d.params.unitCost).toBeUndefined();
    expect(d.params.productName).toBe("Nến thơm");
  });
});

describe("agent.brain — làm sạch params", () => {
  test("giữ nguyên chữ số trong tên sản phẩm + lọc khoảng trắng/ký tự thừa", () => {
    const d = brain.coerceDecision({
      tool: "create_order",
      params: { productName: " Phô mai Oishi Loại 1 ", quantity: "50" },
    });
    expect(d.params.productName).toBe("Phô mai Oishi Loại 1");
    expect(d.params.quantity).toBe(50);
  });

  test("boolean (lowStock/hasDebt) giữ nguyên", () => {
    const d = brain.coerceDecision({ tool: "search_inventory", params: { lowStock: true } });
    expect(d.params.lowStock).toBe(true);
  });
});

describe("agent.brain — diễn dụ khớp code (chống drift prompt ↔ handler)", () => {
  const routeTools = Object.keys(agentRoutes.TOOL_HANDLERS);
  const dbTools = Object.keys(dbAgent.HANDLERS);
  const reachable = new Set([...routeTools, ...dbTools]);

  test("mọi tool brain nhắc trong prompt đều TỒN TẠI ở route hoặc DB", () => {
    const lost = [...brain.TOOL_NAMES].filter((t) => !reachable.has(t));
    expect(lost).toEqual([]);
  });

  test("mọi write tool của brain đều là tool của route (đi đúng đường human-gate)", () => {
    const lost = [...brain.WRITE_TOOLS].filter((t) => !routeTools.includes(t));
    expect(lost).toEqual([]);
  });

  test("prompt nhắc tên tool bằng NGUYÊN VĂN danh mục (không chế tên)", () => {
    for (const name of brain.TOOL_NAMES) {
      // Tên phải nguyên vẹn trong dòng liệt kê của prompt — khớp "- name:"
      // bảo đảm không bị chế tên khác
      expect(brain.SYSTEM_PROMPT).toContain(`- ${name}:`);
    }
  });
});
