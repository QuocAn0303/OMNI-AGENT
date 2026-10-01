/**
 * tests/crm-board-shape.contract.test.js — Contract test shape kanban deal (C1)
 *
 * Vì sao cần test này:
 * C1 là bug nghiêm trọng nhất của CRM — `dealsService.getBoard` trả cột **lồng**
 * (`{ stage: {…}, deals[] }`) còn `KanbanBoard.jsx` đọc shape **phẳng**
 * (`{ id, label, color, items[] }`). Hai bên đúng riêng, ghép vào nhau thì
 * kanban render 0 thẻ, mọi cột rơi về `droppableId = "__unassigned__"`, và
 * drag không gửi request nào (`card = undefined` → `if (!card) return`).
 *
 * Unit test mock Prisma không bao giờ bắt được loại lệch này vì không test nào
 * nối response thật của service vào component thật. Test này làm đúng việc đó:
 *   1. gọi `dealsService.getBoard` thật (Prisma + stages mock) → shape BE
 *   2. **thực thi** `normalizeDealBoard` của frontend (đọc source rồi eval)
 *   3. assert mọi trường mà `KanbanBoard.jsx` đọc đều có dữ liệu
 *
 * Nếu ai đổi shape BE mà quên sửa normalizer (hoặc ngược lại), test đỏ.
 */
const fs = require("fs");
const path = require("path");

const mockClient = {
  crmDeal: { findMany: jest.fn() },
  product: { findMany: jest.fn() },
  customer: { findFirst: jest.fn(), create: jest.fn() },
  crmContact: { update: jest.fn() },
  crmDealItem: { deleteMany: jest.fn(), createMany: jest.fn() },
  user: { findMany: jest.fn() },
};

jest.mock("../src/config/prisma", () => mockClient);

jest.mock("../src/modules/crm/stages.service", () => ({
  ensureDefaultStages: jest.fn().mockResolvedValue(undefined),
  list: jest.fn().mockResolvedValue([
    { id: "s1", label: "Mới", color: "#111111", kind: "ONGOING", probability: 10, entityType: "DEAL", isActive: true, sortOrder: 1 },
    { id: "s2", label: "Thắng", color: "#16a34a", kind: "WON", probability: 100, entityType: "DEAL", isActive: true, sortOrder: 2 },
  ]),
}));

jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn() }));
jest.mock("../src/modules/notifications/notification.service", () => ({ createOne: jest.fn().mockResolvedValue({}) }));
jest.mock("../src/modules/crm/communication.service", () => ({ logSystemEvent: jest.fn().mockResolvedValue(undefined) }));

const dealsService = require("../src/modules/crm/deals.service");

const FE_API_PATH = path.join(__dirname, "..", "frontend", "src", "api", "crm.js");

/**
 * Thực thi `normalizeDealBoard` của frontend.
 *
 * File FE là ESM nên `require` không được. Hàm này là hàm thuần, không import gì,
 * nên ta cắt đúng phần thân nó rồi `new Function` — test chạy **code FE thật**,
 * không phải bản sao. Comment trong thân bị bỏ trước khi đếm ngoặc để `// }`
 * trong chú thích không làm lệch vị trí kết thúc.
 */
const loadFeNormalizer = () => {
  const src = fs.readFileSync(FE_API_PATH, "utf8");
  const marker = "export const normalizeDealBoard";
  const start = src.indexOf(marker);
  if (start === -1) {
    throw new Error(
      `Không tìm thấy \`${marker}\` trong ${FE_API_PATH} — normalizer shape kanban đã bị xoá/ghi đè.`,
    );
  }
  const arrow = src.indexOf("=>", start);
  const bodyStart = src.indexOf("{", arrow);
  const code = src
    .slice(bodyStart)
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

  let depth = 0;
  let end = -1;
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) throw new Error("Không cân bằng được ngoặc của normalizeDealBoard");

  // eslint-disable-next-line no-new-func
  return new Function(`return (raw) => ${code.slice(0, end)};`)();
};

const DEAL_CARD = {
  id: "d1",
  dealName: "Hợp đồng A",
  value: 15000000,
  currency: "VND",
  kind: "ONGOING",
  probability: 30,
  stageId: "s1",
  dealOwnerId: "u1",
  dealOwner: { id: "u1", fullName: "An", role: "CASHIER" },
  organization: { id: "o1", name: "Công ty A" },
  contact: { id: "ct1", fullName: "Bình", email: "b@x.vn", phone: "0900000000" },
};

describe("contract: shape GET /crm/deals/board giữa service và KanbanBoard", () => {
  let normalizeDealBoard;

  beforeAll(() => {
    normalizeDealBoard = loadFeNormalizer();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Query chính: deal có stage → trả về 1 thẻ; query "chưa phân giai đoạn" → rỗng
    mockClient.crmDeal.findMany.mockImplementation(({ where }) =>
      Promise.resolve(where.stageId === null ? [] : [DEAL_CARD]),
    );
    mockClient.user.findMany.mockResolvedValue([]);
  });

  const getRawBoard = () => dealsService.getBoard({ id: "u1", role: "CASHIER" });

  test("BE trả cột LỒNG (stage + deals) — đây là hợp đồng hiện tại", async () => {
    const board = await getRawBoard();
    expect(board.columns.length).toBeGreaterThan(0);

    for (const col of board.columns) {
      expect(Object.keys(col).sort()).toEqual(
        expect.arrayContaining(["stage", "count", "totalValue", "weightedValue", "deals"]),
      );
      expect(col.stage).toEqual(
        expect.objectContaining({ id: expect.anything(), label: expect.any(String), color: expect.any(String), kind: expect.any(String) }),
      );
      expect(Array.isArray(col.deals)).toBe(true);
    }
  });

  test("SỬA LỖI C1: sau normalizer, mọi trường KanbanBoard đọc đều có dữ liệu", async () => {
    const board = normalizeDealBoard(await getRawBoard());

    for (const col of board.columns) {
      // KanbanBoard.jsx:59 `col.items` — phải luôn là mảng (không undefined)
      expect(Array.isArray(col.items)).toBe(true);

      // KanbanBoard.jsx:58 `colKey(col.id)` — id phải khác undefined, mỗi cột 1 droppableId
      expect(col.id === null || typeof col.id === "string").toBe(true);

      // KanbanBoard.jsx:73 `col.label` — đầu cột không được rỗng
      expect(typeof col.label).toBe("string");
      expect(col.label.length).toBeGreaterThan(0);

      // KanbanBoard.jsx:71/74 `col.color` + `col.kind` — màu + icon thắng/thua
      expect(typeof col.color).toBe("string");
      expect(["ONGOING", "WON", "LOST"]).toContain(col.kind);

      // KanbanBoard.jsx:78-83 `col.totalValue` — số để format
      expect(typeof col.totalValue).toBe("number");

      // DealsBoard.jsx:61,69 `c.items` — drag phải tìm được thẻ theo id
      expect(col.items.every((d) => typeof d.id === "string")).toBe(true);
    }

    // Cột s1 (ONGOING) phải hiện đúng 1 thẻ — đây là hàm vi trước C1: `col.items`
    // undefined ⇒ `items = []` ⇒ kanban render 0 thẻ.
    const first = board.columns[0];
    expect(first.id).toBe("s1");
    expect(first.items).toHaveLength(1);
    expect(first.items[0].id).toBe(DEAL_CARD.id);

    // DealsBoard.jsx:61,69 `c.items` — drag phải tìm được thẻ theo id
    const allItems = board.columns.flatMap((c) => c.items);
    expect(allItems.map((d) => d.id)).toEqual([DEAL_CARD.id]);

    // droppableId phải phân biệt được từng cột (lỗi cũ: mọi cột = "__unassigned__")
    const keys = board.columns.map((c) => (c.id ? String(c.id) : "__unassigned__"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("cột 'Chưa phân giai đoạn' (stage.id = null) → id null, items vẫn đọc được", async () => {
    mockClient.crmDeal.findMany.mockImplementation(({ where }) =>
      Promise.resolve(where.stageId === null ? [{ ...DEAL_CARD, id: "d9", stageId: null }] : [DEAL_CARD]),
    );

    const board = normalizeDealBoard(await getRawBoard());
    const unassigned = board.columns.find((c) => c.id === null);

    expect(unassigned).toBeDefined();
    expect(unassigned.items).toHaveLength(1);
    expect(unassigned.items[0].id).toBe("d9");
    expect(unassigned.totalValue).toBe(15000000);
  });

  test("summary đi qua normalizer nguyên vẹn (3 KPI đầu trang)", async () => {
    const board = normalizeDealBoard(await getRawBoard());
    expect(board.summary).toEqual(
      expect.objectContaining({
        totalDeals: expect.any(Number),
        totalValue: expect.any(Number),
        weightedValue: expect.any(Number),
      }),
    );
  });

  test("response rỗng / thiếu field → không vỡ (page vẫn render được)", () => {
    expect(normalizeDealBoard(undefined).columns).toEqual([]);
    expect(normalizeDealBoard({}).summary).toEqual({});
    expect(normalizeDealBoard({ columns: [{}] }).columns[0]).toEqual(
      expect.objectContaining({ id: null, label: "", kind: "ONGOING", items: [] }),
    );
  });
});