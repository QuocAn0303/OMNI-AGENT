/**
 * tests/llm-roles.test.js — Hợp đồng của 2 vai trò LLM + chính sách chạy
 *
 * Những gì test này bắt được (tất cả đều là hành vi KHÔNG được phá):
 *   1. Ca dễ (≥ AUTO_ACCEPT) KHÔNG gọi LLM. Nếu lỡ gọi, token cháy mà không có lý do.
 *   2. Ca dưới ngưỡng KHÔNG gọi LLM (không có gì để LLM phân biệt).
 *   3. LLM không được bịa mã ngoài danh sách ứng viên.
 *   4. `confidence < 0,85` ⇒ vào hàng đợi người xác nhận, không tự áp dụng.
 *   5. **LLM không được sửa số** — provider giả trả về số sai ⇒ output cuối vẫn
 *      dùng số của Bước A (yêu cầu bắt vi phạm ở `01-llm-role.md` §2).
 *   6. Chế độ mặc định là `off`; có key cũng không tự bật.
 *   7. `replay` không đòi key và không gọi mạng.
 *   8. Chặn dữ liệu thật ở chế độ live.
 *
 * Mock `config/llm-policy` (tầng quyết định) thay vì mock provider: hợp đồng nằm ở
 * đây, và nhờ vậy test không phụ thuộc mạng, không cần key.
 */
jest.mock('../src/config/llm-policy', () => {
  const actual = jest.requireActual('../src/config/llm-policy');
  return {
    ...actual,
    callTask: jest.fn(),
    resolveMode: jest.fn(() => 'live'),
    policyStats: jest.fn(() => ({ baseThrottleMs: 0, backoffFactor: 1, mode: 'live' })),
  };
});
jest.mock('../src/config/llm', () => ({
  parseJsonLoose: (t) => {
    try { return JSON.parse(String(t)); } catch { return null; }
  },
  isConfigured: () => true,
  describe: () => ({ provider: 'gemini', model: 'test-model' }),
  config: () => ({ model: 'test-model', provider: 'gemini' }),
  getLastUsage: () => null,
  resetLastUsage: () => {},
  generateText: jest.fn(),
}));

const llmPolicy = require('../src/config/llm-policy');
const llm = require('../src/config/llm');
const { SkuMatcher, MATCH_STATUS, AUTO_ACCEPT_SCORE, REVIEW_SCORE } = require('../src/modules/import/sku-matcher');
const { matchHybridBatch, askLlm, HUMAN_THRESHOLD } = require('../src/modules/import/sku-matcher.hybrid');
const {
  explainProposal, draftVendorMessage, assertNumbersUnchanged, templateExplanation, buildPayload,
} = require('../src/modules/replenishment/proposal-explain.llm');

const CATALOG = [
  { sku: 'SK-A', name: 'INFLATABLE POLITICAL GLOBE' },
  { sku: 'SK-B', name: 'MINI JIGSAW SPACEBOY' },
  { sku: 'SK-C', name: 'LUNCH BAG SPACEBOY DESIGN' },
  { sku: 'SK-D', name: 'PACK OF 12 SPACEBOY TISSUES' },
];

beforeEach(() => {
  llmPolicy.callTask.mockReset();
  llmPolicy.resolveMode.mockReturnValue('live');
});

describe('khớp SKU: công thức trước, LLM chỉ ca mơ hồ', () => {
  test('ca dễ (điểm ≥ AUTO_ACCEPT) KHÔNG gọi LLM', async () => {
    const res = await matchHybridBatch([{ name: 'INFLATABLE POLITICAL GLOBE' }], CATALOG);
    expect(llmPolicy.callTask).not.toHaveBeenCalled();
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0].via).toBe('fuzzy');
    expect(res.matched[0].needsHuman).toBe(false);
  });

  test('ca dưới ngưỡng (NO_MATCH) KHÔNG gọi LLM và vào hàng đợi', async () => {
    const res = await matchHybridBatch([{ name: 'zzz qqq xxx vvv' }], CATALOG);
    expect(llmPolicy.callTask).not.toHaveBeenCalled();
    expect(res.matched).toHaveLength(0);
    expect(res.reviewQueue[0].needsHuman).toBe(true);
    expect(res.reviewQueue[0].sku).toBeNull();
  });

  test('ca mơ hồ [REVIEW, AUTO_ACCEPT) là nơi DUY NHẤT gọi LLM', async () => {
    // Chọn tên rơi đúng khoảng mơ hồ bằng cách dò catalog, giống hành vi thật.
    const matcher = new SkuMatcher(CATALOG);
    const probe = ['POLITICAL GLOBE', 'JIGSAW SPACEBOY', 'SPACEBOY DESIGN']
      .map((n) => ({ n, r: matcher.match(n, {}) }))
      .find((x) => x.r.status === MATCH_STATUS.REVIEW);
    expect(probe).toBeTruthy();
    expect(probe.r.score).toBeGreaterThanOrEqual(REVIEW_SCORE);
    expect(probe.r.score).toBeLessThan(AUTO_ACCEPT_SCORE);

    llmPolicy.callTask.mockResolvedValue({
      ok: true, text: JSON.stringify({ sku: 'SK-A', confidence: 0.93, reason: 'cùng chủng loại' }), mode: 'live',
    });
    const res = await matchHybridBatch([{ name: probe.n }], CATALOG);
    expect(llmPolicy.callTask).toHaveBeenCalledTimes(1);
    expect(res.matched[0].via).toBe('llm');
    expect(res.matched[0].sku).toBe('SK-A');
  });

  test('LLM bịa mã ngoài danh sách ứng viên ⇒ coi như không khớp, vào hàng đợi', async () => {
    const matcher = new SkuMatcher(CATALOG);
    const name = 'POLITICAL GLOBE';
    const cands = matcher.candidatesFor(name, { topK: 5 });
    llmPolicy.callTask.mockResolvedValue({
      ok: true, text: JSON.stringify({ sku: 'KHONG-CO-TRONG-DANH-SACH', confidence: 0.99 }), mode: 'live',
    });
    const ans = await askLlm(name, cands);
    expect(ans.via).toBe('unavailable');
    expect(ans.sku).toBeNull();
    expect(ans.needsHuman).toBe(true);
  });

  test(`confidence < ${HUMAN_THRESHOLD} ⇒ chuyển người, KHÔNG tự áp dụng`, async () => {
    const matcher = new SkuMatcher(CATALOG);
    const name = 'POLITICAL GLOBE';
    llmPolicy.callTask.mockResolvedValue({
      ok: true, text: JSON.stringify({ sku: matcher.candidatesFor(name, { topK: 1 })[0].sku, confidence: 0.84 }), mode: 'live',
    });
    const res = await matchHybridBatch([{ name }], CATALOG);
    expect(res.matched).toHaveLength(0);
    expect(res.reviewQueue[0].via).toBe('llm');
    expect(res.reviewQueue[0].needsHuman).toBe(true);
  });

  test('JSON hỏng ⇒ đường lui, không ném lỗi ra ngoài', async () => {
    llmPolicy.callTask.mockResolvedValue({ ok: true, text: 'không phải JSON', mode: 'live' });
    const res = await matchHybridBatch([{ name: 'POLITICAL GLOBE' }], CATALOG);
    expect(res.reviewQueue).toHaveLength(1);
    expect(res.reviewQueue[0].via).toBe('fallback');
    expect(res.stats.llmMisses).toBe(1);
  });

  test('LLM tắt (mode=off) ⇒ toàn bộ đi qua công thức, không gọi gì', async () => {
    llmPolicy.resolveMode.mockReturnValue('off');
    const res = await matchHybridBatch([{ name: 'POLITICAL GLOBE' }], CATALOG);
    expect(llmPolicy.callTask).not.toHaveBeenCalled();
    expect(res.stats.mode).toBe('off');
    expect(res.matched.length + res.reviewQueue.length).toBe(1);
  });
});

describe('vai trò #2: LLM chỉ nhận số đã tính sẵn, không được sửa số', () => {
  const payload = {
    sku: 'SK-A', name: 'INFLATABLE POLITICAL GLOBE',
    atp: 12, rop: 30, safetyStock: 9, demandPerDay: 2.1, leadTimeDays: 7,
    daysOfCoverLeft: 5.7, orderQty: 42, unitCost: 45000, total: 1890000,
    vendorName: 'NCC Huy Hà', leadTimeEstimated: true,
  };

  test('mặc định (LLM off) ⇒ trả MẪU có nhãn báo, không giả vờ LLM', async () => {
    llmPolicy.resolveMode.mockReturnValue('off');
    const r = await explainProposal(payload);
    expect(r.source).toBe('template');
    expect(r.notice).toBeTruthy();
    expect(r.explanation).toBe(templateExplanation(buildPayload(payload)));
  });

  test('LLM thêm SỐ LẠ ⇒ loại và dùng mẫu (không dùng lời giải thích sai đó)', async () => {
    llmPolicy.callTask.mockResolvedValue({
      ok: true,
      // Cố tình nhân đôi số lượng: đây là vi phạm rõ ràng nhất.
      text: JSON.stringify({ explanation: 'Còn 12, điểm đặt lại 30, đề xuất nhập 84.', flags: [] }),
      mode: 'live',
    });
    const r = await explainProposal(payload);
    expect(r.rejected).toMatch(/LLM_THAO_TAC_SO/);
    expect(r.rejected).toContain('84');
    expect(r.source).toBe('template');
    expect(r.explanation).not.toContain('84');
  });

  test('LLM giữ nguyên số đã cho ⇒ dùng lời giải thích của LLM', async () => {
    llmPolicy.callTask.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ explanation: 'GLOBE còn 12, điểm đặt lại 30.', flags: [] }),
      mode: 'live',
    });
    const r = await explainProposal(payload);
    expect(r.source).toBe('llm');
    expect(r.explanation).toBe('GLOBE còn 12, điểm đặt lại 30.');
  });

  test('tin nhắn NCC: luôn sent=false + requiresHumanSend=true (chỉ soạn)', async () => {
    llmPolicy.callTask.mockResolvedValue({
      ok: true, text: JSON.stringify({ vendorMessage: 'Đề nghị gửi báo giá 42 GLOBE.' }), mode: 'live',
    });
    const r = await draftVendorMessage(payload);
    expect(r.sent).toBe(false);
    expect(r.requiresHumanSend).toBe(true);
  });

  test('assertNumbersUnchanged bắt đúng số lạ, chấp nhận số đã có', () => {
    expect(assertNumbersUnchanged('cần nhập 42, tổng 1.890.000', { orderQty: 42, total: 1890000 }).ok).toBe(true);
    expect(assertNumbersUnchanged('cần nhập 84', { orderQty: 42 }).ok).toBe(false);
    // Số làm tròn khi nói chuyện vẫn được chấp nhận (2.1 → 2).
    expect(assertNumbersUnchanged('nhu cầu khoảng 2 mỗi ngày', { demandPerDay: 2.1 }).ok).toBe(true);
  });

  test('LLM lỗi/429/503 ⇒ mẫu, KHÔNG ném lỗi ra ngoài', async () => {
    llmPolicy.callTask.mockResolvedValue({ ok: false, text: null, reason: 'LLM_ERROR:Gemini HTTP 503', mode: 'live' });
    const r = await explainProposal(payload);
    expect(r.source).toBe('template');
    expect(r.rejected).toContain('503');
  });

  test('Zod bắt thiếu trường ⇒ mẫu', async () => {
    llmPolicy.callTask.mockResolvedValue({ ok: true, text: JSON.stringify({ flags: [] }), mode: 'live' });
    const r = await explainProposal(payload);
    expect(r.source).toBe('template');
  });
});

describe('chính sách chạy LLM (config/llm-policy)', () => {
  const real = jest.requireActual('../src/config/llm-policy');

  test('mặc định (không LLM_MODE) là `off` — có key cũng không tự bật', () => {
    const saved = process.env.LLM_MODE;
    const savedDisabled = process.env.LLM_DISABLED;
    delete process.env.LLM_MODE;
    delete process.env.LLM_DISABLED;
    process.env.GEMINI_API_KEY = 'x'.repeat(20); // chỉ kiểm tra CÓ key, không in giá trị
    expect(real.resolveMode()).toBe('off');
    process.env.LLM_DISABLED = '1';
    process.env.LLM_MODE = 'live';
    expect(real.resolveMode()).toBe('off');
    if (saved === undefined) delete process.env.LLM_MODE; else process.env.LLM_MODE = saved;
    if (savedDisabled === undefined) delete process.env.LLM_DISABLED; else process.env.LLM_DISABLED = savedDisabled;
    delete process.env.GEMINI_API_KEY;
  });

  test('`replay` KHÔNG đòi key (đó là việc của nó) và không gọi mạng', async () => {
    const saved = process.env.LLM_MODE;
    const savedKey = process.env.GEMINI_API_KEY;
    const savedProvider = process.env.LLM_PROVIDER;
    process.env.LLM_MODE = 'replay';
    // Bỏ key + ép provider không dùng được ⇒ chắc chắn `isConfigured()` false.
    delete process.env.GEMINI_API_KEY;
    process.env.LLM_PROVIDER = 'local';
    // `src/config/llm` bị mock ở đầu tệp ⇒ phải hỏi bản THẬT, nếu không
    // `isConfigured()` luôn trả true và khẳng định này thành vô nghĩa.
    expect(jest.requireActual('../src/config/llm').isConfigured()).toBe(false);
    const res = await real.callTask({
      task: real.LLM_TASK.SKU_MATCH, system: 'sys', prompt: `p-${Date.now()}-${Math.random()}`,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('REPLAY_MISS');
    expect(res.mode).toBe('replay');
    if (saved === undefined) delete process.env.LLM_MODE; else process.env.LLM_MODE = saved;
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
    if (savedProvider === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = savedProvider;
  });

  test('chặn dữ liệu thật ở chế độ live: LLM_DATA_TAG không phải nhãn công khai', async () => {
    const savedMode = process.env.LLM_MODE;
    const savedTag = process.env.LLM_DATA_TAG;
    process.env.LLM_MODE = 'live';
    process.env.LLM_DATA_TAG = 'du-lieu-khach-hang-that';
    const res = await real.callTask({
      task: real.LLM_TASK.PROPOSAL_EXPLAIN, system: 'sys', prompt: 'du lieu that',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('REAL_DATA_BLOCKED');
    process.env.LLM_MODE = 'replay';
    process.env.LLM_DATA_TAG = 'mophong';
    if (savedMode === undefined) delete process.env.LLM_MODE; else process.env.LLM_MODE = savedMode;
    if (savedTag === undefined) delete process.env.LLM_DATA_TAG; else process.env.LLM_DATA_TAG = savedTag;
  });

  test('khóa bản ghi không phụ thuộc model ⇒ đổi LLM_MODEL không làm hỏng replay', () => {
    const a = real.callKey({ task: 'SKU_MATCH', system: 's', prompt: 'p', model: 'gemini-a' });
    const b = real.callKey({ task: 'SKU_MATCH', system: 's', prompt: 'p', model: 'gemini-b' });
    expect(a).toBe(b);
    expect(a).not.toBe(real.callKey({ task: 'SKU_MATCH', system: 's', prompt: 'q' }));
  });

  test('429/503 được nhận là lỗi tạm thời, 401/404 thì không', () => {
    expect(real.isTransient('Gemini HTTP 429: quota')).toBe(true);
    expect(real.isTransient('Gemini HTTP 503')).toBe(true);
    expect(real.isTransient('Gemini HTTP 404: model not found')).toBe(false);
    expect(real.isTransient('Gemini HTTP 401: key sai')).toBe(false);
  });
});